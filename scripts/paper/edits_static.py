"""Edits that do not depend on measured numbers: wording that must match what the prototype really does."""
from __future__ import annotations

from docx_tools import Docx, paren, r, sqrt, sub


def W(n: int) -> str:
    return sub(r("w"), r(str(n)))


def apply_static(d: Docx) -> None:
    # ---- introduction / contributions
    d.replace_in(9, "cloud-native", "containerized")
    d.replace_in(16, "modular adapters (Shopify, SAP, Zoho)", "modular adapters (Shopify- and Zoho-compatible)")
    d.replace_in(18, "LangChain Retailer and Wholesaler agents under strict floor/ceiling price limits.",
                 "Retailer and Wholesaler agents follow a deterministic three-turn protocol under strict floor/ceiling limits; an LLM only words messages.")
    d.replace_in(19, "privacy-preserving federated learning that predicts shortages 2–3 weeks ahead.",
                 "privacy-preserving federated learning that shares a regional demand index.")

    # ---- literature review: describe CARPIP accurately
    d.replace_in(23, "which CARPIP uses so its agents adapt to price and seasonal shifts without retraining.",
                 "which CARPIP echoes by separating perception (MPI, forecasts), memory (logs) and action (ordering).")
    d.replace_in(23, "which CARPIP avoids through a lightweight cloud-native federated design.",
                 "which CARPIP avoids by enforcing a maximum acceptable price centrally.")
    d.replace_in(23, "which CARPIP extends to multi-turn negotiation between competing entities.",
                 "which CARPIP extends to multi-turn negotiation between a retailer and several wholesalers.")
    d.replace_in(23, "CARPIP operationalizes such planning by executing real Purchase Orders (POs) through ERP writebacks.",
                 "CARPIP operationalizes such planning by writing Purchase Orders (POs) to supplier ERP systems.")
    d.replace_in(25, "CARPIP feeds the dynamic MPI into the federated loop.", "CARPIP feeds the federated regional demand index into the dynamic MPI.")
    d.replace_in(25, "whereas CARPIP proactively predicts national supply shortages from regional sales velocities.",
                 "whereas CARPIP shares regional demand-growth ratios to anticipate demand surges.")
    d.replace_in(27, "a software-only Universal API Middleware", "a software-only dual-path integration layer")
    d.replace_in(27, "which CARPIP adapts to structured B2B procurement data.",
                 "which motivates LLMs on structured B2B data, though CARPIP limits the LLM to wording messages.")

    # ---- methodology
    d.replace_in(34, "has four entities", "centres on four entities")
    d.replace_in(34, "Order", "PurchaseOrder")
    d.replace_in(34, "NegotiationLog", "Negotiation")
    d.replace_in(34, " (agent turn transcripts).", " (with a per-turn log).")
    d.replace_in(37, "the Shopify POS adapter maps product variants (SKUs, quantities, prices) to Product entities and writes completed orders back through HMAC-SHA256-validated webhooks, and connectors for SAP, Oracle and Zoho translate wholesale catalogs, inventories and pricing into native entities.",
                 "the Shopify-compatible adapter maps product variants (SKUs, quantities, prices) to Product entities, receives sales through HMAC-SHA256-validated webhooks and writes stock back, and a Zoho Inventory-style adapter maps wholesale catalogs and sales orders (both validated on demo systems; no SAP or Oracle connector).")
    d.replace_in(45, "Spring Boot tests currentStock ≤ reorderPoint whenever stock changes.",
                 "Spring Boot tests the inventory position (stock plus on-order) ≤ reorderPoint whenever stock changes.")
    d.replace_in(47, "LangChain runs a turn-based Retailer–Wholesaler negotiation governed by mathematical rules to a final unit price.",
                 "the engine negotiates turn by turn with each candidate supplier under mathematical rules (an LLM words the messages) and ranks the accepted quotes.")
    d.replace_in(48, "saves the Order as ACCEPTED or REJECTED and writes the approved PO back to the retailer’s ERP or API endpoint.",
                 "saves the PO as approved, pending approval or rejected and writes the approved PO to the selected supplier’s ERP.")

    # ---- MPI definitions, bounds, CDIN, API
    d.set_text(55, "bounded to [0.10, 0.95]",
               "with r = 1 − pos/(2·max(ROP,1)) and c = 1 − pos/(2v(L+S)) (pos: position, v: demand, L: lead time, S: safety days), bounded to [0.10, 0.95] and non-increasing in stock; "
               "Supply Availability (SA) is the reliability-weighted supplier coverage of the order quantity; Price Volatility (PV) is the supplier price coefficient of variation divided by 0.20; "
               "the Seasonal Index (SI) scales a category base (0.78 Electronics, 0.45 Food & Beverage, 0.62 Office, 0.82 Lifestyle) by forecast growth; and the Competitive Signal (CS) combines the "
               "CDIN regional index, a macro setting and competitor prices. The hand-set weights are w₁…w₅ = 0.315, 0.225, 0.18, 0.18, 0.10. "
               "A high MPI (sellers’ market) lets the Wholesaler raise floors; a low MPI (buyers’ market) lets the Retailer obtain larger discounts.")
    d.set_text(60, "At MPI = 1.0",
               "The floor never falls below the supplier’s maximum discount δ; the retailer’s maximum acceptable price is RMAP = min(BasePrice, RetailPrice × (1 − margin) × (1 + 0.05u)), with urgency u. "
               "The protocol fixes every action; the LLM only words messages and may move a price by at most ±1%, all prices are clamped to the bounds, and failures fall back to rule wording (Figure 1.3).")
    d.set_text(62, "CDIN aggregates",
               "CDIN lets regional retailers share demand signals without sharing sales data. Each node trains the LSTM locally (FedProx) and uploads only weights and coarse per-product sales-velocity ratios; "
               "the coordinator merges validated updates by sample-weighted FedAvg and publishes a regional demand index (RDI) for products reported by at least two nodes, feeding the MPI and a bounded (±30%) "
               "forecast uplift (no differential privacy).")
    d.set_text(66, "the ordering timeline",
               "where the inner maximum is the fixed floor, followed by shelf-life, MOQ and pack-size adjustments (D: forecast demand, L: lead time, R: review days, σ: demand deviation); "
               "the timeline (T) accounts for lead times and shipping buffers; suppliers are ranked by price, reliability, expiry risk and lead time (weights 0.40/0.25/0.15/0.20).")

    # ---- equations
    mpi = (r("MPI", True) + r("=") + W(1) + r("×") + r("DP", True) + r("+") + W(2) + r("×") + paren(r("1-") + r("SA", True)) + r("+") + W(3) + r("×") + r("PV", True)
           + r("+") + W(4) + r("×") + r("SI", True) + r("+") + W(5) + r("×") + r("CS", True))
    d.set_equation(52, "MPI", mpi)
    d.set_equation(54, "DP", r("DP", True) + r("=0.10+0.85") + paren(r("0.5r+0.5c")))
    d.set_equation(58, "FloorPrice", r("FloorPrice", True) + r("=") + r("max", True)
                   + paren(r("BasePrice", True) + r("×") + paren(r("0.80+0.10×") + r("MPI", True)) + r(",") + r("BasePrice", True) + r("×") + paren(r("1-δ"))))
    d.set_equation(65, "Q", r("Q=") + r("max", True)
                   + paren(r("max", True) + paren(r("(ROP-pos)×2,50")) + r(",⌈D(L+R)+1.65σ") + sqrt(r("L")) + r("-pos⌉")))
