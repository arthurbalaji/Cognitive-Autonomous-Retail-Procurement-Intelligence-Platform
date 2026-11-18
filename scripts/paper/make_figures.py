"""Redraw the paper figures (grayscale, same pixel sizes/style as the camera-ready originals).
    python scripts/paper/make_figures.py   ->  scripts/paper/figs/image{1,2,3}.png
"""
from __future__ import annotations

import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon

plt.rcParams["font.family"] = ["Arial", "DejaVu Sans"]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "figs")
LW = 1.5 * 72 / 100          # 1.5 px in points at dpi 100
GRAY, WHITE = "#f2f2f2", "white"
TS, BS = 10.5, 10            # title / body font size (pt)
PITCH = 19                   # px between text lines


def canvas(w: int, h: int):
    fig = plt.figure(figsize=(w / 100, h / 100), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, w)
    ax.set_ylim(h, 0)
    ax.axis("off")
    return fig, ax


def box(ax, x, y, w, h, fill=WHITE, r=9, z=2):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}", fc=fill, ec="black", lw=LW, zorder=z))


def block(ax, cx, cy, items, z=5):
    """Centered text block; items = [(text, bold)], extra gap after the leading bold lines."""
    n = len(items)
    gap = 5 if items and items[0][1] and n > 1 and not items[-1][1] else 0
    total = (n - 1) * PITCH + gap
    y = cy - total / 2
    for i, (t, b) in enumerate(items):
        ax.text(cx, y, t, ha="center", va="center", fontsize=TS if b else BS, fontweight="bold" if b else "normal", zorder=z, linespacing=1.0)
        y += PITCH + (gap if (b and i + 1 < n and not items[i + 1][1]) else 0)


def card(ax, x, y, w, h, items, fill=WHITE):
    box(ax, x, y, w, h, fill)
    block(ax, x + w / 2, y + h / 2, items)


def arrow(ax, p0, p1, dashed=False, both=False, z=3):
    ax.annotate("", xy=p1, xytext=p0, zorder=z,
                arrowprops=dict(arrowstyle="<|-|>" if both else "-|>", lw=LW, color="black", mutation_scale=14, shrinkA=0, shrinkB=0,
                                linestyle="--" if dashed else "-"))


def label(ax, x, y, t, ha="left", z=6, bg=True, size=BS):
    ax.text(x, y, t, ha=ha, va="center", fontsize=size, zorder=z, bbox=dict(fc="white", ec="none", pad=1.5) if bg else None)


def save(fig, name, w, h):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name)
    fig.savefig(p, dpi=100, facecolor="white")
    plt.close(fig)
    from PIL import Image
    assert Image.open(p).size == (w, h), (name, Image.open(p).size)
    print(name, (w, h))


# ------------------------------------------------------------------------------------------------ Figure 1.1
def fig1():
    W, H = 935, 561
    fig, ax = canvas(W, H)
    card(ax, 8, 2, 277, 76, [("POS (retail)", True), ("Shopify-compatible or", False), ("legacy REST store", False)])
    card(ax, 322, 2, 291, 76, [("FRONTEND SPA", True), ("(React 18, Vite, TypeScript,", False), ("Tailwind CSS)", False)])
    card(ax, 650, 2, 277, 76, [("ERP (wholesale)", True), ("Zoho-style or", False), ("custom REST/webhooks", False)])
    arrow(ax, (146, 78), (146, 140))
    label(ax, 154, 109, "signed webhooks / REST")
    arrow(ax, (467, 78), (467, 140))
    label(ax, 475, 109, "REST + SSE (JWT)")
    arrow(ax, (788, 78), (788, 140))
    label(ax, 780, 109, "signed webhooks", ha="right")

    box(ax, 8, 140, 919, 132, GRAY)
    ax.text(467, 160, "CORE TRANSACTIONAL SERVER (Spring Boot 3.3, Port 8080)", ha="center", va="center", fontsize=TS, fontweight="bold", zorder=5)
    card(ax, 24, 182, 280, 74, [("Auth:", False), ("JWT + API keys", False)])
    card(ax, 327, 182, 280, 74, [("Transactional outbox +", False), ("idempotent consumers", False)])
    card(ax, 630, 182, 281, 74, [("ERP adapters: Shopify-,", False), ("Zoho-style, custom REST", False)])

    box(ax, 8, 318, 392, 152, GRAY)
    block(ax, 204, 342, [("COGNITIVE INTELLIGENCE ENGINE", True), ("(Python 3.11, Flask, Port 5000)", False)])
    box(ax, 20, 376, 368, 84, WHITE)
    for i, t in enumerate(["• Market Pulse Index (every 15 min)", "• Bounded negotiation, Claude via Bedrock", "• Forecasting ensemble, CDIN coordinator"]):
        ax.text(30, 393 + i * 24, t, ha="left", va="center", fontsize=BS, zorder=5)
    arrow(ax, (204, 272), (204, 318), both=True)
    label(ax, 212, 295, "HTTP, internal token")

    box(ax, 420, 318, 245, 152, GRAY)
    ax.text(542, 337, "POSTGRESQL 15 + REDIS 7", ha="center", va="center", fontsize=TS, fontweight="bold", zorder=5)
    card(ax, 432, 355, 221, 52, [("carpip DB: tenants,", False), ("products, POs, logs", False)])
    card(ax, 432, 412, 221, 48, [("Redis: rate limiting,", False), ("JWT revocation", False)])
    arrow(ax, (542, 272), (542, 318))
    label(ax, 550, 295, "JPA / JDBC")

    box(ax, 685, 318, 242, 152, GRAY)
    ax.text(806, 337, "APACHE KAFKA", ha="center", va="center", fontsize=TS, fontweight="bold", zorder=5)
    card(ax, 697, 355, 218, 105, [("sales.events", False), ("inventory.updates", False), ("procurement.requests", False), ("po.lifecycle (+ DLT)", False)])
    arrow(ax, (806, 272), (806, 318))
    label(ax, 814, 295, "event streaming")

    card(ax, 8, 508, 392, 46, [("CDIN nodes (3): local LSTM training", False), ("only model weights are uploaded", False)])
    arrow(ax, (204, 508), (204, 470))
    label(ax, 212, 489, "weights only (FedAvg)")
    save(fig, "image1.png", W, H)


# ------------------------------------------------------------------------------------------------ Figure 1.2
def fig2():
    W, H = 935, 570
    fig, ax = canvas(W, H)
    card(ax, 3, 4, 310, 118, [("Step 1: Data Ingest", True), ("POS / ERP webhook (HMAC-signed)", False), ("or REST push with API key", False)])
    card(ax, 328, 4, 296, 118, [("Step 2: Event Routing", True), ("Transactional outbox relays to", False), ("Kafka sales.events and", False), ("inventory.updates", False)])
    card(ax, 640, 4, 290, 118, [("Step 3: Threshold", True), ("Evaluation", True), ("Idempotent consumer updates", False), ("versioned stock in PostgreSQL", False)])
    arrow(ax, (313, 63), (328, 63))
    arrow(ax, (624, 63), (640, 63))

    # decision diamond
    cx, cy, hw, hh = 785, 270, 142, 80
    ax.add_patch(Polygon([(cx, cy - hh), (cx + hw, cy), (cx, cy + hh), (cx - hw, cy)], closed=True, fc=WHITE, ec="black", lw=LW, zorder=2))
    block(ax, cx, cy, [("Inventory position", False), ("(stock + on-order)", False), ("≤ ROP ?", False)])
    arrow(ax, (785, 122), (785, 190))

    card(ax, 328, 205, 296, 130, [("Step 4: AI Activation", True), ("Create PO (NEGOTIATING);", False), ("dispatch lean JSON to Flask", False), ("/api/negotiate", False)])
    arrow(ax, (643, 270), (624, 270))
    ax.text(633, 249, "Yes", ha="center", va="center", fontsize=BS, zorder=6)

    card(ax, 3, 205, 310, 130, [("Step 5: Bounded", True), ("Negotiation", True), ("MPI → supplier bounds → 3-turn", False), ("protocol (Claude or rule voice)", False), ("→ ranking", False)])
    arrow(ax, (328, 270), (313, 270))

    card(ax, 3, 395, 310, 168, [("Step 6: Order Persistence", True), ("& ERP Writeback", True), ("Approval mode, writeback queue", False), ("to supplier ERP; receipt adjusts", False), ("POS stock", False)])
    arrow(ax, (158, 335), (158, 395))

    card(ax, 640, 440, 290, 90, [("No action", True), ("Continue monitoring", False)])
    arrow(ax, (785, 350), (785, 440))
    label(ax, 797, 395, "No")
    save(fig, "image2.png", W, H)


# ------------------------------------------------------------------------------------------------ Figure 1.3
def fig3():
    W, H = 935, 561
    fig, ax = canvas(W, H)
    L, R = 158, 775
    for x in (L, R):
        card(ax, x - 117, 3, 234, 46, [("Retailer agent" if x == L else "Wholesaler agent", False)])
        card(ax, x - 117, 512, 234, 46, [("Retailer agent" if x == L else "Wholesaler agent", False)])
        ax.plot([x, x], [49, 512], color="black", lw=LW, zorder=1)

    def msg(y, text, to_right=True, dashed=False):
        a, b = (L, R) if to_right else (R, L)
        arrow(ax, (a, y), (b, y), dashed=dashed)
        ax.text((L + R) / 2, y - 13, text, ha="center", va="center", fontsize=BS, zorder=6)

    msg(88, "Turn 1: Offers bid = min(0.82 × Base, RMAP)")
    card(ax, R - 150, 100, 300, 44, [("Checks bid ≥ Floor?", False), ("If not, counters", False)])
    msg(172, "Turn 1 counter-offer: (Base + Floor) / 2", to_right=False, dashed=True)
    msg(215, "Turn 2: Offers min((bid + counter) / 2, RMAP)")
    card(ax, R - 150, 227, 300, 44, [("Checks mid ≥ Floor?", False), ("Yes: accepts; no: final offer", False)])
    msg(298, "Turn 2 response: FINAL_OFFER = Floor", to_right=False, dashed=True)
    card(ax, L - 150, 312, 300, 40, [("Checks: final offer ≤ RMAP ?", False)])
    msg(386, "[final offer ≤ RMAP]  Turn 3: Accepts final price")
    msg(425, "[final offer > RMAP]  Turn 3: Terminates as REJECTED")
    box(ax, 205, 448, 525, 50, GRAY, z=4)
    block(ax, 467, 473, [("Claude (or rule voice) words each message only;", False), ("prices clamped: wholesaler in [Floor, Base], accepted in [Floor, RMAP]", False)])
    save(fig, "image3.png", W, H)


if __name__ == "__main__":
    fig1()
    fig2()
    fig3()
