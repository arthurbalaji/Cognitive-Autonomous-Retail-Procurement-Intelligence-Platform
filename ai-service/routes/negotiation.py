from flask import Blueprint, jsonify, request
from datetime import datetime
import json
import os

negotiation_bp = Blueprint('negotiation', __name__)


class RetailerAgent:
    """AI agent representing the retailer's interests in negotiations."""

    def __init__(self, forecast_data, product_data):
        self.forecast = forecast_data
        self.product = product_data
        self.max_price = product_data.get('base_price', 100) * 0.95  # willing to pay up to 95% of list
        self.target_price = product_data.get('base_price', 100) * 0.80  # target 20% below list

    def check_forecast(self):
        """Check demand forecast to inform negotiation strategy."""
        demand = self.forecast.get('predicted_demand_7d', 50)
        risk = self.forecast.get('risk', 'MEDIUM')
        return {
            'predicted_demand': demand,
            'risk_level': risk,
            'urgency': 'HIGH' if risk in ['CRITICAL', 'HIGH'] else 'NORMAL'
        }

    def propose_buy_price(self, quantity):
        """Propose an initial buying price based on volume and market conditions."""
        base = self.product.get('base_price', 100)

        # Volume discount
        if quantity >= 100:
            discount = 0.20
        elif quantity >= 50:
            discount = 0.15
        else:
            discount = 0.10

        # Urgency adjustment — less aggressive if critical
        forecast_info = self.check_forecast()
        if forecast_info['urgency'] == 'HIGH':
            discount *= 0.7  # reduce discount demand when desperate

        proposed = round(base * (1 - discount), 2)
        return {
            'proposed_price': proposed,
            'quantity': quantity,
            'discount_pct': round(discount * 100, 1),
            'reasoning': f'Volume discount of {discount*100:.1f}% for {quantity} units. '
                        f'Demand risk: {forecast_info["risk_level"]}'
        }

    def accept_offer(self, offered_price, quantity):
        """Decide whether to accept a counter-offer."""
        if offered_price <= self.max_price:
            savings = round((self.product.get('base_price', 100) - offered_price) * quantity, 2)
            return {
                'accepted': True,
                'final_price': offered_price,
                'quantity': quantity,
                'total': round(offered_price * quantity, 2),
                'savings': savings,
                'reasoning': f'Price ${offered_price} is within budget. Savings: ${savings}'
            }
        return {
            'accepted': False,
            'reasoning': f'Price ${offered_price} exceeds maximum budget of ${self.max_price}'
        }


class WholesalerAgent:
    """AI agent representing the wholesaler's interests in negotiations."""

    def __init__(self, inventory_data, mpi_data):
        self.inventory = inventory_data
        self.mpi = mpi_data
        self.min_price = inventory_data.get('base_price', 100) * 0.85  # won't go below 85% of list
        self.target_price = inventory_data.get('base_price', 100) * 0.95  # want 95% of list

    def check_inventory_pressure(self):
        """Assess inventory pressure to inform pricing strategy."""
        stock = self.inventory.get('current_stock', 500)
        if stock > 1000:
            pressure = 'LOW'
            willingness_to_discount = 'HIGH'
        elif stock > 200:
            pressure = 'MODERATE'
            willingness_to_discount = 'MEDIUM'
        else:
            pressure = 'HIGH'
            willingness_to_discount = 'LOW'

        return {
            'current_stock': stock,
            'pressure': pressure,
            'willingness_to_discount': willingness_to_discount
        }

    def calculate_mpi_discount(self, base_price):
        """Calculate discount based on Market Pulse Index."""
        mpi_value = self.mpi.get('value', 0.5)

        # Higher MPI = less discount (more demand = seller's market)
        if mpi_value > 0.7:
            max_discount = 0.05  # only 5% in hot market
        elif mpi_value > 0.4:
            max_discount = 0.12  # moderate discount
        else:
            max_discount = 0.20  # aggressive discount in low demand

        # Inventory pressure adjustment
        pressure_info = self.check_inventory_pressure()
        if pressure_info['pressure'] == 'LOW':
            max_discount *= 1.3  # more willing to discount overstocked items

        discounted_price = round(base_price * (1 - max_discount), 2)

        return {
            'mpi_value': mpi_value,
            'max_discount_pct': round(max_discount * 100, 1),
            'discounted_price': max(discounted_price, self.min_price),
            'reasoning': f'MPI at {mpi_value:.2f} ({self.mpi.get("trend", "STABLE")}). '
                        f'Inventory pressure: {pressure_info["pressure"]}'
        }

    def counter_offer(self, proposed_price, quantity):
        """Generate a counter-offer based on proposed price."""
        base = self.inventory.get('base_price', 100)
        mpi_discount = self.calculate_mpi_discount(base)

        floor_price = max(self.min_price, mpi_discount['discounted_price'])

        if proposed_price >= floor_price:
            # Accept — it's above our floor
            return {
                'action': 'ACCEPT',
                'price': proposed_price,
                'quantity': quantity,
                'total': round(proposed_price * quantity, 2),
                'reasoning': f'Proposed ${proposed_price} meets our floor of ${floor_price:.2f}'
            }

        # Counter-offer: midpoint between proposed and our target
        counter_price = round((proposed_price + self.target_price) / 2, 2)
        counter_price = max(counter_price, self.min_price)

        return {
            'action': 'COUNTER',
            'price': counter_price,
            'quantity': quantity,
            'total': round(counter_price * quantity, 2),
            'discount_from_list': round((1 - counter_price / base) * 100, 1),
            'reasoning': f'Counter at ${counter_price} ({(1 - counter_price/base)*100:.1f}% off list). '
                        f'MPI-adjusted floor: ${floor_price:.2f}'
        }


def run_negotiation(product_data, forecast_data, mpi_data, max_turns=3):
    """
    Orchestrate a multi-turn negotiation between Retailer and Wholesaler agents.
    Maximum of `max_turns` back-and-forth exchanges.
    """
    retailer = RetailerAgent(forecast_data, product_data)
    wholesaler = WholesalerAgent(product_data, mpi_data)

    transcript = []
    quantity = forecast_data.get('predicted_demand_7d', 50)
    final_result = None

    # System message
    transcript.append({
        'agent': 'SYSTEM',
        'action': 'INIT',
        'message': f'Negotiation initiated for {product_data.get("name", product_data.get("sku", "Unknown"))} '
                   f'— Stock at {product_data.get("current_stock", "?")} units, '
                   f'forecast demand: {quantity} units/week.',
        'timestamp': datetime.utcnow().isoformat()
    })

    for turn in range(max_turns):
        # Retailer proposes
        if turn == 0:
            proposal = retailer.propose_buy_price(quantity)
            transcript.append({
                'agent': 'RETAILER_AGENT',
                'action': 'PROPOSE',
                'message': f'Proposing purchase of {quantity} units at ${proposal["proposed_price"]}/unit '
                          f'({proposal["discount_pct"]}% below list). {proposal["reasoning"]}',
                'data': proposal,
                'timestamp': datetime.utcnow().isoformat()
            })
            current_price = proposal['proposed_price']
        else:
            # Retailer counter-proposes (midpoint between last counter and their target)
            counter_price = round((current_price + retailer.target_price) / 2, 2)
            # Adjust quantity as negotiation tactic
            adjusted_qty = max(quantity - 10 * turn, int(quantity * 0.6))
            transcript.append({
                'agent': 'RETAILER_AGENT',
                'action': 'COUNTER',
                'message': f'Counter-proposing ${counter_price}/unit for {adjusted_qty} units. '
                          f'Willing to reduce quantity for better unit price.',
                'data': {'price': counter_price, 'quantity': adjusted_qty},
                'timestamp': datetime.utcnow().isoformat()
            })
            current_price = counter_price
            quantity = adjusted_qty

        # Wholesaler responds
        response = wholesaler.counter_offer(current_price, quantity)
        transcript.append({
            'agent': 'WHOLESALER_AGENT',
            'action': response['action'],
            'message': f'{"Accepted" if response["action"] == "ACCEPT" else "Counter-offer"}: '
                      f'${response["price"]}/unit × {quantity} = ${response["total"]}. '
                      f'{response["reasoning"]}',
            'data': response,
            'timestamp': datetime.utcnow().isoformat()
        })

        if response['action'] == 'ACCEPT':
            final_result = {
                'status': 'ACCEPTED',
                'final_price': response['price'],
                'quantity': quantity,
                'total': response['total'],
                'turns': turn + 1,
                'savings': round((product_data.get('base_price', 100) - response['price']) * quantity, 2)
            }
            break

        # Retailer evaluates counter-offer
        current_price = response['price']
        eval_result = retailer.accept_offer(current_price, quantity)

        if eval_result['accepted']:
            transcript.append({
                'agent': 'RETAILER_AGENT',
                'action': 'ACCEPT',
                'message': f'Accepted at ${current_price}/unit. {eval_result["reasoning"]}',
                'data': eval_result,
                'timestamp': datetime.utcnow().isoformat()
            })
            final_result = {
                'status': 'ACCEPTED',
                'final_price': current_price,
                'quantity': quantity,
                'total': eval_result['total'],
                'turns': turn + 1,
                'savings': eval_result['savings']
            }
            break

    # If no agreement reached after max turns
    if final_result is None:
        final_result = {
            'status': 'REJECTED',
            'message': 'Maximum negotiation turns reached without agreement',
            'turns': max_turns,
            'last_offer': current_price
        }

    # System conclusion
    transcript.append({
        'agent': 'SYSTEM',
        'action': 'COMPLETE',
        'message': f'Negotiation {"complete" if final_result["status"] == "ACCEPTED" else "failed"}. '
                   f'Status: {final_result["status"]}. '
                   f'{"Total: $" + str(final_result.get("total", "N/A")) + ". Savings: $" + str(final_result.get("savings", 0)) if final_result["status"] == "ACCEPTED" else "No agreement reached."}',
        'timestamp': datetime.utcnow().isoformat()
    })

    return {
        'result': final_result,
        'transcript': transcript
    }


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
        'reorder_point': 25
    })

    forecast_data = data.get('forecast', {
        'predicted_demand_7d': 40,
        'risk': 'CRITICAL',
        'confidence': 0.85
    })

    mpi_data = data.get('mpi', {
        'value': 0.72,
        'trend': 'STABLE'
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
        'reorder_point': 25
    }
    forecast_data = {
        'predicted_demand_7d': 40,
        'risk': 'CRITICAL',
        'confidence': 0.85
    }
    mpi_data = {
        'value': 0.72,
        'trend': 'STABLE'
    }

    result = run_negotiation(product_data, forecast_data, mpi_data, max_turns=3)
    return jsonify(result)
