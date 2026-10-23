"""Turn-by-turn bounded negotiation state machine (paper Fig. 4, at most 3 retailer turns).

    T1  Retailer  OFFER  bid = min(Target, RMAP)
        Wholesaler: bid >= Floor ? ACCEPT : COUNTER (Base + Floor)/2
    T2  Retailer  OFFER  mid = min((bid + counter)/2, RMAP)
        Wholesaler: mid >= Floor ? ACCEPT : FINAL_OFFER Floor
    T3  Retailer  Floor' <= RMAP ? ACCEPT : REJECT

Corrections to the paper: the T2 offer is capped at RMAP and the T3 test compares the wholesaler's final offer with the
retailer's maximum acceptable price (the paper's `Floor <= 0.90*Base` is always true).

Safety model: *the action of every turn is decided here, deterministically*.  A Voice (rule templates or an LLM) may
only word the message and nudge the price inside a +-flex band that is itself clamped to the hard economic bounds.
Whatever a voice returns is clamped again here, so the invariants
    Floor <= wholesaler price <= Ceiling,     Floor <= accepted price <= RMAP,     turns <= 3
hold for arbitrary (even adversarial / hallucinated) voice output.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal
from typing import Callable, Protocol

from .bounds import CENT, Bounds, d, q2


@dataclass
class VoiceOut:
    proposed_price: Decimal | None = None   # None -> use the deterministic price
    message: str = ""
    source: str = "RULE"                    # RULE | LLM
    wrong_action: bool = False              # voice tried to change the action (counted as an intervention)
    reason: str | None = None               # guardrail reason (invalid json, timeout, ...)
    usage: dict = field(default_factory=dict)


@dataclass
class Turn:
    turn: int
    actor: str
    action: str
    price: Decimal | None
    deterministic_price: Decimal | None
    llm_proposed_price: Decimal | None
    clamped: bool
    source: str
    message: str
    guardrail: str | None = None

    def as_dict(self) -> dict:
        return {
            "turn": self.turn, "actor": self.actor, "action": self.action,
            "price": None if self.price is None else str(self.price),
            "deterministicPrice": None if self.deterministic_price is None else str(self.deterministic_price),
            "llmProposedPrice": None if self.llm_proposed_price is None else str(self.llm_proposed_price),
            "clamped": self.clamped, "source": self.source, "message": self.message, "guardrail": self.guardrail,
        }


@dataclass
class Result:
    status: str                       # ACCEPTED | REJECTED
    final_price: Decimal | None
    turns: list[Turn]
    interventions: int
    accepted_at_turn: int | None


class Voice(Protocol):
    def speak(self, *, actor: str, turn_no: int, action: str, det_price: Decimal | None, lo: Decimal | None,
              hi: Decimal | None, history: list[Turn], bounds: Bounds, ctx: dict) -> VoiceOut: ...


class RuleVoice:
    """Deterministic templates - used when the LLM is off, unavailable, over budget or misbehaving."""

    def speak(self, *, actor, turn_no, action, det_price, lo, hi, history, bounds, ctx) -> VoiceOut:
        qty = ctx.get("quantity", "")
        name = ctx.get("name", "the item")
        p = f"INR {det_price}" if det_price is not None else ""
        msg = {
            ("RETAILER", "OFFER", 1): f"We would like to order {qty} units of {name}. Our opening offer is {p} per unit.",
            ("WHOLESALER", "COUNTER", 1): f"Thank you for the offer. We can meet you at {p} per unit.",
            ("WHOLESALER", "ACCEPT", 1): f"Agreed - {p} per unit works for us.",
            ("RETAILER", "OFFER", 2): f"Let us meet in the middle: {p} per unit.",
            ("WHOLESALER", "ACCEPT", 2): f"Agreed at {p} per unit.",
            ("WHOLESALER", "FINAL_OFFER", 2): f"That is the best we can do: {p} per unit, our final offer.",
            ("RETAILER", "ACCEPT", 3): f"Accepted at {p} per unit.",
            ("RETAILER", "REJECT", 3): "That is above the price we can accept for this item, so we must decline this time.",
        }.get((actor, action, turn_no), "")
        return VoiceOut(proposed_price=det_price, message=msg, source="RULE")


def _band(det: Decimal, flex: Decimal, lo_limit: Decimal, hi_limit: Decimal) -> tuple[Decimal, Decimal]:
    """+-flex band around det, clamped into [lo_limit, hi_limit].  Rounded inward so the band never leaves the limits."""
    lo = q2(det * (1 - flex), ROUND_CEILING)
    hi = q2(det * (1 + flex), ROUND_FLOOR)
    lo = max(lo, lo_limit)
    hi = min(hi, hi_limit)
    det = max(lo_limit, min(hi_limit, det))
    if lo > hi:
        lo = hi = det
    lo, hi = min(lo, det), max(hi, det)
    return lo, hi


def _clamp(x: Decimal, lo: Decimal, hi: Decimal) -> Decimal:
    return max(lo, min(hi, x))


def negotiate(bounds: Bounds, voice: Voice, flex_pct: float = 0.01, ctx: dict | None = None,
              on_turn: Callable[[Turn], None] | None = None) -> Result:
    ctx = ctx or {}
    b = bounds
    flex = d(flex_pct)
    turns: list[Turn] = []
    interventions = 0

    def say(turn_no: int, actor: str, action: str, det: Decimal | None, lo: Decimal | None, hi: Decimal | None) -> Decimal | None:
        nonlocal interventions
        out = voice.speak(actor=actor, turn_no=turn_no, action=action, det_price=det, lo=lo, hi=hi, history=turns, bounds=b, ctx=ctx)
        price: Decimal | None = None
        clamped = False
        if det is not None:
            proposed = out.proposed_price if out.proposed_price is not None else det
            price = _clamp(q2(proposed), lo, hi)           # hard guardrail, whatever the voice said
            clamped = price != q2(proposed)
        if clamped or out.wrong_action:
            interventions += 1          # a real guardrail override (price clamped or action changed)
        turn = Turn(turn=turn_no, actor=actor, action=action, price=price, deterministic_price=det,
                    llm_proposed_price=out.proposed_price if out.source == "LLM" else None,
                    clamped=clamped, source=out.source, message=(out.message or "")[:280], guardrail=out.reason)
        turns.append(turn)
        if on_turn is not None:
            try:
                on_turn(turn)
            except Exception:  # noqa: BLE001 - observers must never break a negotiation
                pass
        return price

    # ---- turn 1
    det_bid = max(min(b.target, b.rmap), CENT)
    lo, hi = _band(det_bid, flex, CENT, b.rmap)
    bid = say(1, "RETAILER", "OFFER", det_bid, lo, hi)
    if bid >= b.floor:
        price = say(1, "WHOLESALER", "ACCEPT", bid, bid, bid)
        return Result("ACCEPTED", price, turns, interventions, 1)
    det_counter = _clamp(q2((b.base + b.floor) / 2), b.floor, b.ceiling)
    lo, hi = _band(det_counter, flex, b.floor, b.ceiling)
    counter = say(1, "WHOLESALER", "COUNTER", det_counter, lo, hi)

    # ---- turn 2
    det_mid = max(min(q2((bid + counter) / 2), b.rmap), CENT)
    lo, hi = _band(det_mid, flex, CENT, b.rmap)
    mid = say(2, "RETAILER", "OFFER", det_mid, lo, hi)
    if mid >= b.floor:
        price = say(2, "WHOLESALER", "ACCEPT", mid, mid, mid)
        return Result("ACCEPTED", price, turns, interventions, 2)
    lo, hi = _band(b.floor, flex, b.floor, b.ceiling)
    final_offer = say(2, "WHOLESALER", "FINAL_OFFER", b.floor, lo, hi)

    # ---- turn 3
    if final_offer <= b.rmap:
        price = say(3, "RETAILER", "ACCEPT", final_offer, final_offer, final_offer)
        return Result("ACCEPTED", price, turns, interventions, 3)
    say(3, "RETAILER", "REJECT", None, None, None)
    return Result("REJECTED", None, turns, interventions, None)
