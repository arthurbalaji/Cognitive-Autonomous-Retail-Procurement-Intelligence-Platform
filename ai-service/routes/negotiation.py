"""
CARPIP Multi-Agent Negotiation Engine
=====================================
Uses LangChain with Google Vertex AI (Gemini) for LLM-powered multi-agent
procurement negotiations between Retailer and Wholesaler agents.

Each agent has dedicated tools for data-driven decision making, and the LLM
provides natural language reasoning and strategic negotiation behavior.

Falls back to rule-based logic if Vertex AI is unavailable.
"""

from flask import Blueprint, jsonify, request
from datetime import datetime
import json
import os
import logging

logger = logging.getLogger(__name__)

negotiation_bp = Blueprint('negotiation', __name__)

# ═══════════════════════════════════════════════════════════════════════════════
# LLM INITIALIZATION
# ═══════════════════════════════════════════════════════════════════════════════

_llm = None
_llm_available = None  # None = not yet tested, True/False = tested


def get_llm():
    """
    Lazily initialize the Gemini LLM via LangChain + Vertex AI (Agent Platform).
    Uses ChatGoogleGenerativeAI with project/credentials to route through the
    Vertex AI backend (NOT the Gemini Developer API).
    See: https://python.langchain.com/docs/integrations/chat/google_generative_ai/#backend-selection
    Returns None if initialization fails (triggers fallback to rule-based).
    """
    global _llm, _llm_available

    if _llm_available is False:
        return None
    if _llm is not None:
        return _llm

    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
        from google.oauth2 import service_account

        credentials_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS', '')
        project_id = os.environ.get('GCP_PROJECT_ID', 'gen-lang-client-0550374026')
        location = os.environ.get('GCP_LOCATION', 'global')

        if not credentials_path or not os.path.exists(credentials_path):
            # Try common relative paths for local development
            for candidate in [
                './credentials/service-account.json',
                '../credentials/service-account.json',
                os.path.join(os.path.dirname(__file__), '..', 'credentials', 'service-account.json'),
            ]:
                if os.path.exists(candidate):
                    credentials_path = os.path.abspath(candidate)
                    os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = credentials_path
                    break

        if not credentials_path or not os.path.exists(credentials_path):
            logger.warning("No GCP service account found. LLM negotiation disabled.")
            _llm_available = False
            return None

        # Load service account credentials — this triggers Vertex AI backend
        # selection in ChatGoogleGenerativeAI (per LangChain docs: when
        # credentials or project param is provided, Vertex AI is used)
        scopes = ['https://www.googleapis.com/auth/cloud-platform']
        credentials = service_account.Credentials.from_service_account_file(
            credentials_path, scopes=scopes
        )

        _llm = ChatGoogleGenerativeAI(
            model="gemini-3.5-flash",
            project=project_id,
            location=location,
            credentials=credentials,
            temperature=0.3,
            max_output_tokens=1024,
        )

        _llm_available = True
        logger.info(
            f"Vertex AI LLM initialized: model=gemini-3.5-flash, "
            f"project={project_id}, location={location}, "
            f"backend=vertex-ai (Agent Platform)"
        )
        return _llm

    except Exception as e:
        logger.warning(f"Failed to initialize Vertex AI LLM: {e}. Using rule-based fallback.")
        _llm_available = False
        _llm = None
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# TOOL DEFINITIONS — Retailer Agent
# ═══════════════════════════════════════════════════════════════════════════════

def make_retailer_tools(product_data: dict, forecast_data: dict):
    """Create LangChain tools for the Retailer Agent."""
    from langchain_core.tools import tool

    base_price = product_data.get('base_price', 100)
    max_price = base_price * 0.95
    target_price = base_price * 0.80

    @tool
    def check_forecast() -> dict:
        """Check the demand forecast to understand urgency and inform negotiation strategy.
        Returns predicted demand, risk level, and urgency assessment."""
        demand = forecast_data.get('predicted_demand_7d', 50)
        risk = forecast_data.get('risk', 'MEDIUM')
        confidence = forecast_data.get('confidence', 0.75)
        return {
            'predicted_demand_7d': demand,
            'risk_level': risk,
            'confidence': confidence,
            'urgency': 'HIGH' if risk in ['CRITICAL', 'HIGH'] else 'NORMAL',
            'days_of_stock_remaining': max(1, int(product_data.get('current_stock', 0) / max(1, demand / 7))),
        }

    @tool
    def propose_buy_price(quantity: int) -> dict:
        """Propose an initial buying price for the given quantity.
        Uses volume discounts and urgency to calculate a fair opening offer.
        Args:
            quantity: Number of units to purchase.
        Returns the proposed price per unit, discount percentage, and reasoning."""
        if quantity >= 100:
            discount = 0.20
        elif quantity >= 50:
            discount = 0.15
        else:
            discount = 0.10

        forecast_info = check_forecast.invoke({})
        if forecast_info['urgency'] == 'HIGH':
            discount *= 0.7

        proposed = round(base_price * (1 - discount), 2)
        return {
            'proposed_price': proposed,
            'quantity': quantity,
            'discount_pct': round(discount * 100, 1),
            'max_acceptable_price': round(max_price, 2),
            'total_cost': round(proposed * quantity, 2),
        }

    @tool
    def accept_offer(offered_price: float, quantity: int) -> dict:
        """Evaluate whether a counter-offer price is acceptable.
        Compares against our maximum budget and calculates savings.
        Args:
            offered_price: The price per unit being offered.
            quantity: The number of units.
        Returns acceptance decision, savings calculation, and reasoning."""
        if offered_price <= max_price:
            savings = round((base_price - offered_price) * quantity, 2)
            return {
                'accepted': True,
                'final_price': offered_price,
                'quantity': quantity,
                'total': round(offered_price * quantity, 2),
                'savings': savings,
                'savings_pct': round((1 - offered_price / base_price) * 100, 1),
            }
        return {
            'accepted': False,
            'offered_price': offered_price,
            'max_acceptable': round(max_price, 2),
            'gap': round(offered_price - max_price, 2),
        }

    return [check_forecast, propose_buy_price, accept_offer]


# ═══════════════════════════════════════════════════════════════════════════════
# TOOL DEFINITIONS — Wholesaler Agent
# ═══════════════════════════════════════════════════════════════════════════════

def make_wholesaler_tools(product_data: dict, mpi_data: dict):
    """Create LangChain tools for the Wholesaler Agent."""
    from langchain_core.tools import tool

    base_price = product_data.get('base_price', 100)
    min_price = base_price * 0.85
    target_price = base_price * 0.95

    @tool
    def check_inventory_pressure() -> dict:
        """Check current inventory levels to determine selling pressure.
        High stock = more willing to discount. Low stock = hold firm on price.
        Returns current stock, pressure level, and willingness to discount."""
        stock = product_data.get('current_stock', 500)
        if stock > 1000:
            pressure = 'LOW'
            willingness = 'HIGH'
        elif stock > 200:
            pressure = 'MODERATE'
            willingness = 'MEDIUM'
        else:
            pressure = 'HIGH'
            willingness = 'LOW'

        return {
            'current_stock': stock,
            'pressure': pressure,
            'willingness_to_discount': willingness,
            'reorder_point': product_data.get('reorder_point', 25),
        }

    @tool
    def calculate_mpi_discount(offered_base_price: float) -> dict:
        """Calculate the maximum discount we can offer based on the Market Pulse Index.
        Higher MPI means more demand = seller's market = less discount.
        Args:
            offered_base_price: The list price to calculate discount from.
        Returns MPI value, maximum discount percentage, and floor price."""
        mpi_value = mpi_data.get('value', 0.5)
        trend = mpi_data.get('trend', 'STABLE')

        if mpi_value > 0.7:
            max_discount = 0.05
        elif mpi_value > 0.4:
            max_discount = 0.12
        else:
            max_discount = 0.20

        inv = check_inventory_pressure.invoke({})
        if inv['pressure'] == 'LOW':
            max_discount *= 1.3

        floor = max(round(offered_base_price * (1 - max_discount), 2), round(min_price, 2))

        return {
            'mpi_value': mpi_value,
            'mpi_trend': trend,
            'max_discount_pct': round(max_discount * 100, 1),
            'floor_price': floor,
            'absolute_minimum_price': round(min_price, 2),
        }

    @tool
    def counter_offer(proposed_price: float, quantity: int) -> dict:
        """Evaluate a buyer's proposed price and either accept or generate a counter-offer.
        Args:
            proposed_price: The buyer's proposed price per unit.
            quantity: The number of units requested.
        Returns action (ACCEPT or COUNTER), price, and reasoning."""
        mpi_info = calculate_mpi_discount.invoke({'offered_base_price': base_price})
        floor_price = mpi_info['floor_price']

        if proposed_price >= floor_price:
            return {
                'action': 'ACCEPT',
                'price': proposed_price,
                'quantity': quantity,
                'total': round(proposed_price * quantity, 2),
                'discount_given_pct': round((1 - proposed_price / base_price) * 100, 1),
            }

        counter_price = round((proposed_price + target_price) / 2, 2)
        counter_price = max(counter_price, round(min_price, 2))

        return {
            'action': 'COUNTER',
            'price': counter_price,
            'quantity': quantity,
            'total': round(counter_price * quantity, 2),
            'discount_from_list_pct': round((1 - counter_price / base_price) * 100, 1),
            'floor_price': floor_price,
        }

    return [check_inventory_pressure, calculate_mpi_discount, counter_offer]


# ═══════════════════════════════════════════════════════════════════════════════
# LLM-POWERED AGENT RUNNER
# ═══════════════════════════════════════════════════════════════════════════════

def run_agent_turn(llm, system_prompt: str, user_prompt: str, tools: list) -> dict:
    """
    Run a single agent turn: send prompt to LLM with bound tools,
    execute any tool calls, then get the agent's final response.

    Returns: {message: str, tool_calls: list[dict], tool_results: list[dict]}
    """
    from langchain_core.messages import SystemMessage, HumanMessage

    llm_with_tools = llm.bind_tools(tools)
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]

    # First LLM call — may include tool_calls
    response = llm_with_tools.invoke(messages)

    tool_calls_made = []
    tool_results = []

    if hasattr(response, 'tool_calls') and response.tool_calls:
        # Build a tool name -> function lookup
        tool_map = {t.name: t for t in tools}
        messages.append(response)  # Add AI message with tool calls

        for tc in response.tool_calls:
            tool_name = tc['name']
            tool_args = tc['args']
            tool_calls_made.append({'tool': tool_name, 'args': tool_args})

            if tool_name in tool_map:
                result = tool_map[tool_name].invoke(tool_args)
                tool_results.append({'tool': tool_name, 'result': result})

                # Add tool result as a ToolMessage
                from langchain_core.messages import ToolMessage
                messages.append(ToolMessage(
                    content=json.dumps(result) if isinstance(result, dict) else str(result),
                    tool_call_id=tc['id'],
                ))
            else:
                from langchain_core.messages import ToolMessage
                messages.append(ToolMessage(
                    content=json.dumps({'error': f'Unknown tool: {tool_name}'}),
                    tool_call_id=tc['id'],
                ))

        # Second LLM call — generate natural language response using tool results
        final_response = llm_with_tools.invoke(messages)
        message_text = final_response.content
    else:
        message_text = response.content

    return {
        'message': message_text,
        'tool_calls': tool_calls_made,
        'tool_results': tool_results,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# LLM NEGOTIATION ORCHESTRATOR
# ═══════════════════════════════════════════════════════════════════════════════

def run_llm_negotiation(llm, product_data, forecast_data, mpi_data, max_turns=3):
    """
    Orchestrate a multi-turn LLM-powered negotiation between
    Retailer Agent and Wholesaler Agent using Gemini function calling.
    """
    product_name = product_data.get('name', product_data.get('sku', 'Unknown Product'))
    base_price = product_data.get('base_price', 100)
    current_stock = product_data.get('current_stock', 0)
    demand = forecast_data.get('predicted_demand_7d', 50)

    retailer_tools = make_retailer_tools(product_data, forecast_data)
    wholesaler_tools = make_wholesaler_tools(product_data, mpi_data)

    # System prompts for each agent
    retailer_system = (
        "You are the RETAILER AGENT in a B2B procurement negotiation. "
        "Your goal is to purchase inventory at the best possible price for your retail business. "
        "You MUST use your tools to make data-driven decisions — always call check_forecast first, "
        "then propose_buy_price or accept_offer as appropriate. "
        "Be strategic: leverage volume, urgency, and market conditions. "
        "Respond with a concise negotiation message (2-3 sentences max). "
        "Include specific numbers (price, quantity, discount %) in your response. "
        "Output ONLY your negotiation message, no extra commentary."
    )

    wholesaler_system = (
        "You are the WHOLESALER AGENT in a B2B procurement negotiation. "
        "Your goal is to sell inventory at the highest profitable price while maintaining the business relationship. "
        "You MUST use your tools to make data-driven decisions — always call check_inventory_pressure first, "
        "then use calculate_mpi_discount and counter_offer to evaluate proposals. "
        "Be strategic: consider MPI, inventory pressure, and volume. "
        "Respond with a concise negotiation message (2-3 sentences max). "
        "Include specific numbers (price, quantity, discount %) in your response. "
        "Output ONLY your negotiation message, no extra commentary."
    )

    transcript = []
    quantity = demand
    final_result = None

    # ─── SYSTEM INIT ───
    transcript.append({
        'agent': 'SYSTEM',
        'action': 'INIT',
        'message': (
            f'LLM-powered negotiation initiated for {product_name} '
            f'— Stock at {current_stock} units, forecast demand: {quantity} units/week. '
            f'MPI: {mpi_data.get("value", "N/A")} ({mpi_data.get("trend", "UNKNOWN")}). '
            f'Engine: Google Gemini via LangChain.'
        ),
        'timestamp': datetime.utcnow().isoformat(),
    })

    conversation_history = []
    current_price = None

    for turn in range(max_turns):
        # ─── RETAILER TURN ───
        if turn == 0:
            retailer_prompt = (
                f"We need to purchase {product_name} (SKU: {product_data.get('sku', 'N/A')}). "
                f"Current stock is critically low at {current_stock} units with a reorder point of {product_data.get('reorder_point', 25)}. "
                f"List price is ${base_price}/unit. "
                f"Use check_forecast to assess demand, then propose_buy_price for {quantity} units. "
                f"Make your opening offer."
            )
        else:
            retailer_prompt = (
                f"The wholesaler countered at ${current_price}/unit for {quantity} units. "
                f"Use accept_offer to evaluate this price (offered_price={current_price}, quantity={quantity}). "
                f"If not acceptable, propose a counter-offer. Consider adjusting quantity if needed."
            )

        # Add conversation context
        if conversation_history:
            retailer_prompt += "\n\nNegotiation history:\n" + "\n".join(conversation_history[-4:])

        retailer_result = run_agent_turn(llm, retailer_system, retailer_prompt, retailer_tools)

        # Extract price from tool results
        for tr in retailer_result['tool_results']:
            if tr['tool'] == 'propose_buy_price' and isinstance(tr['result'], dict):
                current_price = tr['result'].get('proposed_price', current_price)
                quantity = tr['result'].get('quantity', quantity)
            elif tr['tool'] == 'accept_offer' and isinstance(tr['result'], dict):
                if tr['result'].get('accepted'):
                    # Retailer accepted the wholesaler's counter
                    transcript.append({
                        'agent': 'RETAILER_AGENT',
                        'action': 'ACCEPT',
                        'message': retailer_result['message'],
                        'data': {
                            'tool_calls': retailer_result['tool_calls'],
                            'tool_results': retailer_result['tool_results'],
                        },
                        'timestamp': datetime.utcnow().isoformat(),
                    })
                    final_result = {
                        'status': 'ACCEPTED',
                        'final_price': tr['result']['final_price'],
                        'quantity': tr['result']['quantity'],
                        'total': tr['result']['total'],
                        'turns': turn + 1,
                        'savings': tr['result']['savings'],
                    }
                    conversation_history.append(f"RETAILER: {retailer_result['message']}")
                    break

        if final_result:
            break

        action = 'PROPOSE' if turn == 0 else 'COUNTER'
        transcript.append({
            'agent': 'RETAILER_AGENT',
            'action': action,
            'message': retailer_result['message'],
            'data': {
                'tool_calls': retailer_result['tool_calls'],
                'tool_results': retailer_result['tool_results'],
            },
            'timestamp': datetime.utcnow().isoformat(),
        })
        conversation_history.append(f"RETAILER: {retailer_result['message']}")

        # ─── WHOLESALER TURN ───
        wholesaler_prompt = (
            f"The retailer {'proposes' if turn == 0 else 'counter-proposes'} "
            f"${current_price}/unit for {quantity} units of {product_name} (list price: ${base_price}). "
            f"Use check_inventory_pressure to assess your position, then counter_offer "
            f"(proposed_price={current_price}, quantity={quantity}) to evaluate and respond."
        )
        if conversation_history:
            wholesaler_prompt += "\n\nNegotiation history:\n" + "\n".join(conversation_history[-4:])

        wholesaler_result = run_agent_turn(llm, wholesaler_system, wholesaler_prompt, wholesaler_tools)

        # Extract action from tool results
        wholesaler_action = 'COUNTER'
        for tr in wholesaler_result['tool_results']:
            if tr['tool'] == 'counter_offer' and isinstance(tr['result'], dict):
                if tr['result'].get('action') == 'ACCEPT':
                    wholesaler_action = 'ACCEPT'
                    current_price = tr['result']['price']
                    final_result = {
                        'status': 'ACCEPTED',
                        'final_price': tr['result']['price'],
                        'quantity': tr['result']['quantity'],
                        'total': tr['result']['total'],
                        'turns': turn + 1,
                        'savings': round((base_price - tr['result']['price']) * tr['result']['quantity'], 2),
                    }
                else:
                    current_price = tr['result']['price']
                    quantity = tr['result'].get('quantity', quantity)

        transcript.append({
            'agent': 'WHOLESALER_AGENT',
            'action': wholesaler_action,
            'message': wholesaler_result['message'],
            'data': {
                'tool_calls': wholesaler_result['tool_calls'],
                'tool_results': wholesaler_result['tool_results'],
            },
            'timestamp': datetime.utcnow().isoformat(),
        })
        conversation_history.append(f"WHOLESALER: {wholesaler_result['message']}")

        if final_result:
            break

    # ─── NO AGREEMENT ───
    if final_result is None:
        final_result = {
            'status': 'REJECTED',
            'message': 'Maximum negotiation turns reached without agreement',
            'turns': max_turns,
            'last_offer': current_price,
        }

    # ─── SYSTEM CONCLUSION ───
    if final_result['status'] == 'ACCEPTED':
        conclusion = (
            f'Negotiation complete. Status: ACCEPTED. '
            f'Final: ${final_result["final_price"]}/unit × {final_result["quantity"]} = '
            f'${final_result["total"]}. Savings: ${final_result.get("savings", 0)}. '
            f'Resolved in {final_result["turns"]} turn(s). Engine: Gemini LLM.'
        )
    else:
        conclusion = (
            f'Negotiation failed. Status: REJECTED. '
            f'{final_result.get("message", "No agreement reached.")} '
            f'Last offer: ${final_result.get("last_offer", "N/A")}.'
        )

    transcript.append({
        'agent': 'SYSTEM',
        'action': 'COMPLETE',
        'message': conclusion,
        'timestamp': datetime.utcnow().isoformat(),
    })

    return {
        'result': final_result,
        'transcript': transcript,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# RULE-BASED FALLBACK (original logic, used when LLM is unavailable)
# ═══════════════════════════════════════════════════════════════════════════════

def run_fallback_negotiation(product_data, forecast_data, mpi_data, max_turns=3):
    """
    Rule-based negotiation fallback. Used when Gemini LLM is unavailable.
    Preserves the original deterministic logic for reliability.
    """
    base_price = product_data.get('base_price', 100)
    max_price = base_price * 0.95
    target_price_r = base_price * 0.80
    min_price_w = base_price * 0.85
    target_price_w = base_price * 0.95

    transcript = []
    quantity = forecast_data.get('predicted_demand_7d', 50)
    final_result = None

    transcript.append({
        'agent': 'SYSTEM',
        'action': 'INIT',
        'message': (
            f'Negotiation initiated for {product_data.get("name", product_data.get("sku", "Unknown"))} '
            f'— Stock at {product_data.get("current_stock", "?")} units, '
            f'forecast demand: {quantity} units/week. (Rule-based fallback mode)'
        ),
        'timestamp': datetime.utcnow().isoformat(),
    })

    for turn in range(max_turns):
        if turn == 0:
            # Retailer proposes
            risk = forecast_data.get('risk', 'MEDIUM')
            discount = 0.20 if quantity >= 100 else (0.15 if quantity >= 50 else 0.10)
            if risk in ['CRITICAL', 'HIGH']:
                discount *= 0.7
            proposed = round(base_price * (1 - discount), 2)
            current_price = proposed

            transcript.append({
                'agent': 'RETAILER_AGENT',
                'action': 'PROPOSE',
                'message': (
                    f'Proposing purchase of {quantity} units at ${proposed}/unit '
                    f'({round(discount * 100, 1)}% below list). '
                    f'Demand risk: {risk}.'
                ),
                'data': {'proposed_price': proposed, 'quantity': quantity, 'discount_pct': round(discount * 100, 1)},
                'timestamp': datetime.utcnow().isoformat(),
            })
        else:
            counter_price = round((current_price + target_price_r) / 2, 2)
            adjusted_qty = max(quantity - 10 * turn, int(quantity * 0.6))
            transcript.append({
                'agent': 'RETAILER_AGENT',
                'action': 'COUNTER',
                'message': (
                    f'Counter-proposing ${counter_price}/unit for {adjusted_qty} units. '
                    f'Willing to reduce quantity for better unit price.'
                ),
                'data': {'price': counter_price, 'quantity': adjusted_qty},
                'timestamp': datetime.utcnow().isoformat(),
            })
            current_price = counter_price
            quantity = adjusted_qty

        # Wholesaler responds
        mpi_value = mpi_data.get('value', 0.5)
        stock = product_data.get('current_stock', 500)
        w_max_disc = 0.05 if mpi_value > 0.7 else (0.12 if mpi_value > 0.4 else 0.20)
        if stock > 1000:
            w_max_disc *= 1.3
        floor_price = max(min_price_w, round(base_price * (1 - w_max_disc), 2))

        if current_price >= floor_price:
            transcript.append({
                'agent': 'WHOLESALER_AGENT',
                'action': 'ACCEPT',
                'message': (
                    f'Accepted: ${current_price}/unit × {quantity} = ${round(current_price * quantity, 2)}. '
                    f'Proposed price meets our floor of ${floor_price:.2f}.'
                ),
                'data': {'action': 'ACCEPT', 'price': current_price, 'quantity': quantity, 'total': round(current_price * quantity, 2)},
                'timestamp': datetime.utcnow().isoformat(),
            })
            final_result = {
                'status': 'ACCEPTED',
                'final_price': current_price,
                'quantity': quantity,
                'total': round(current_price * quantity, 2),
                'turns': turn + 1,
                'savings': round((base_price - current_price) * quantity, 2),
            }
            break

        counter_w = round((current_price + target_price_w) / 2, 2)
        counter_w = max(counter_w, min_price_w)
        transcript.append({
            'agent': 'WHOLESALER_AGENT',
            'action': 'COUNTER',
            'message': (
                f'Counter-offer: ${counter_w}/unit × {quantity} = ${round(counter_w * quantity, 2)}. '
                f'MPI at {mpi_value:.2f} ({mpi_data.get("trend", "STABLE")}). '
                f'Floor: ${floor_price:.2f}.'
            ),
            'data': {'action': 'COUNTER', 'price': counter_w, 'quantity': quantity, 'total': round(counter_w * quantity, 2)},
            'timestamp': datetime.utcnow().isoformat(),
        })
        current_price = counter_w

        # Retailer evaluates
        if current_price <= max_price:
            savings = round((base_price - current_price) * quantity, 2)
            transcript.append({
                'agent': 'RETAILER_AGENT',
                'action': 'ACCEPT',
                'message': f'Accepted at ${current_price}/unit. Savings: ${savings}.',
                'data': {'accepted': True, 'final_price': current_price, 'quantity': quantity, 'total': round(current_price * quantity, 2), 'savings': savings},
                'timestamp': datetime.utcnow().isoformat(),
            })
            final_result = {
                'status': 'ACCEPTED',
                'final_price': current_price,
                'quantity': quantity,
                'total': round(current_price * quantity, 2),
                'turns': turn + 1,
                'savings': savings,
            }
            break

    if final_result is None:
        final_result = {
            'status': 'REJECTED',
            'message': 'Maximum negotiation turns reached without agreement',
            'turns': max_turns,
            'last_offer': current_price,
        }

    status_text = 'complete' if final_result['status'] == 'ACCEPTED' else 'failed'
    if final_result['status'] == 'ACCEPTED':
        conclusion = (
            f'Negotiation {status_text}. Status: {final_result["status"]}. '
            f'Total: ${final_result.get("total", "N/A")}. Savings: ${final_result.get("savings", 0)}.'
        )
    else:
        conclusion = f'Negotiation {status_text}. Status: {final_result["status"]}. No agreement reached.'

    transcript.append({
        'agent': 'SYSTEM',
        'action': 'COMPLETE',
        'message': conclusion,
        'timestamp': datetime.utcnow().isoformat(),
    })

    return {
        'result': final_result,
        'transcript': transcript,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC ORCHESTRATOR
# ═══════════════════════════════════════════════════════════════════════════════

def run_negotiation(product_data, forecast_data, mpi_data, max_turns=3):
    """
    Run a multi-agent negotiation. Attempts LLM-powered (Gemini) first,
    falls back to rule-based if Vertex AI is unavailable.
    """
    llm = get_llm()

    if llm is not None:
        try:
            return run_llm_negotiation(llm, product_data, forecast_data, mpi_data, max_turns)
        except Exception as e:
            logger.error(f"LLM negotiation failed: {e}. Falling back to rule-based.")

    return run_fallback_negotiation(product_data, forecast_data, mpi_data, max_turns)


# ═══════════════════════════════════════════════════════════════════════════════
# FLASK ROUTES (API contract unchanged)
# ═══════════════════════════════════════════════════════════════════════════════

@negotiation_bp.route('/negotiate', methods=['POST'])
def negotiate():
    """
    Run a multi-agent negotiation for a purchase order.

    Expected body:
    {
        "product": { "sku": "...", "name": "...", "base_price": 34.50, "current_stock": 12 },
        "forecast": { "predicted_demand_7d": 40, "risk": "CRITICAL" },
        "mpi": { "value": 0.72, "trend": "STABLE" },
        "max_turns": 3
    }
    """
    data = request.get_json()

    product_data = data.get('product', {
        'sku': 'SKU-003',
        'name': 'Bamboo Desk Organizer',
        'base_price': 34.50,
        'current_stock': 12,
        'reorder_point': 25,
    })

    forecast_data = data.get('forecast', {
        'predicted_demand_7d': 40,
        'risk': 'CRITICAL',
        'confidence': 0.85,
    })

    mpi_data = data.get('mpi', {
        'value': 0.72,
        'trend': 'STABLE',
    })

    max_turns = data.get('max_turns', 3)

    result = run_negotiation(product_data, forecast_data, mpi_data, max_turns)
    return jsonify(result)


@negotiation_bp.route('/negotiate/demo', methods=['GET'])
def negotiate_demo():
    """Run a demo negotiation with preset data."""
    product_data = {
        'sku': 'SKU-003',
        'name': 'Bamboo Desk Organizer',
        'base_price': 34.50,
        'current_stock': 12,
        'reorder_point': 25,
    }
    forecast_data = {
        'predicted_demand_7d': 40,
        'risk': 'CRITICAL',
        'confidence': 0.85,
    }
    mpi_data = {
        'value': 0.72,
        'trend': 'STABLE',
    }

    result = run_negotiation(product_data, forecast_data, mpi_data, max_turns=3)
    return jsonify(result)


@negotiation_bp.route('/negotiate/status', methods=['GET'])
def negotiate_status():
    """Check whether LLM negotiation is available or in fallback mode."""
    llm = get_llm()
    return jsonify({
        'engine': 'gemini-llm' if llm is not None else 'rule-based-fallback',
        'llm_available': llm is not None,
        'model': 'gemini-2.5-flash' if llm is not None else None,
        'provider': 'Google Vertex AI (Agent Platform)' if llm is not None else 'Local rule engine',
    })
