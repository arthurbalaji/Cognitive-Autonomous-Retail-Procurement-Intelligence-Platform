"""Deterministic synthetic retail dataset for the CARPIP demo (seeded; same SEED => identical data).

Modelled on the Dunnhumby "Complete Journey" shape (product x store x day units/revenue) but scaled down for a laptop:
  * ~120 SKUs, 3 stores, ~120 days of history (documented as synthetic - NOT the paper's 43,000-SKU benchmark)
  * weekly seasonality, slow trends, promotions, intermittent (slow-moving) SKUs, per-store scale (non-IID)
  * a *regional precursor*: for a few SKUs stores 1 and 2 see a demand surge ~14 days before store 3 does - the signal
    the CDIN federated network should detect and share without exchanging raw sales.
"""
from __future__ import annotations

import hashlib
import math
import random
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np

# (name, category, wholesale cost INR, pack size, shelf life days or None)
FOOD = [
    ("Aashirvaad Atta 5kg", 205), ("Tata Salt 1kg", 24), ("Fortune Sunflower Oil 1L", 128), ("Parle-G Biscuits 800g", 62), ("Amul Butter 500g", 265),
    ("Maggi 2-Minute Noodles 12-pack", 140), ("Tata Tea Gold 500g", 240), ("Britannia Good Day 600g", 105), ("Bru Instant Coffee 200g", 395),
    ("Madhur Sugar 5kg", 205), ("Toor Dal 1kg", 140), ("India Gate Basmati Rice 5kg", 560), ("Sona Masoori Rice 10kg", 520), ("Haldiram Bhujia 400g", 95),
    ("Kissan Mixed Fruit Jam 500g", 150), ("Dabur Honey 500g", 215), ("MDH Garam Masala 100g", 78), ("Everest Turmeric Powder 200g", 70),
    ("Red Label Tea 1kg", 460), ("Nescafe Classic 100g", 285), ("Horlicks Classic 1kg", 470), ("Bournvita 500g", 235), ("Amul Gold UHT Milk 1L", 68),
    ("Amul Cheese Slices 200g", 125), ("Real Mixed Fruit Juice 1L", 98), ("Coca-Cola 2L", 85), ("Pepsi 2.25L", 90), ("Bisleri Water 20L", 80),
    ("Lays Classic 52g 24-pack", 410), ("Kurkure Masala Munch 12-pack", 220), ("Oreo Biscuits 300g", 78), ("Sunfeast Dark Fantasy 300g", 108),
    ("Kelloggs Corn Flakes 875g", 340), ("Saffola Oats 1kg", 195), ("Tropicana Orange 1L", 105), ("Patanjali Cow Ghee 1L", 590), ("Amul Ghee 1L", 640),
    ("Mothers Recipe Pickle 500g", 145), ("Chings Schezwan Chutney 250g", 95), ("Knorr Tomato Soup 12-pack", 150), ("Del Monte Ketchup 1kg", 150),
    ("Kissan Ketchup 950g", 120), ("Priya Mango Pickle 300g", 120), ("Wai Wai Noodles 30-pack", 330), ("Haldiram Soan Papdi 500g", 160),
    ("Cadbury Dairy Milk 150g", 130), ("Nestle KitKat 36-pack", 360), ("Parle Hide and Seek 400g", 100), ("Tata Sampann Moong Dal 1kg", 150),
    ("Tata Sampann Chana Dal 1kg", 120), ("Rajdhani Besan 1kg", 105), ("Pillsbury Atta 10kg", 400), ("Nandini Curd 500g", 28), ("Amul Lassi 200ml", 18),
]
ELEC = [
    ("Mi Power Bank 10000mAh", 899), ("boAt Rockerz Wired Earphones", 1099), ("USB-C Cable 1m", 129), ("Micro-USB Cable 1m", 99), ("Fast Charger 20W", 399),
    ("Philips LED Bulb 9W 6-pack", 399), ("Duracell AA Batteries 10-pack", 360), ("Eveready AAA Batteries 10-pack", 190), ("Extension Board 4-socket", 265),
    ("HDMI Cable 2m", 249), ("Bluetooth Speaker Mini", 799), ("Wired Mouse", 249), ("Wireless Mouse", 499), ("Keyboard Mouse Combo", 699),
    ("Pen Drive 32GB", 349), ("Pen Drive 64GB", 499), ("MicroSD Card 64GB", 579), ("Phone Stand", 149), ("Screen Guard Pack", 99), ("Bluetooth Earbuds", 1299),
    ("Smart Plug Wi-Fi", 599), ("LED Torch", 199), ("Table Fan 12 inch", 1199), ("Hair Dryer 1000W", 549),
]
OFFICE = [
    ("A4 Paper Ream 500 sheets", 235), ("Classmate Notebook 6-pack", 330), ("Reynolds Ball Pen 20-pack", 150), ("Pilot V5 Pen 12-pack", 360),
    ("Staedtler Pencils 10-pack", 55), ("Apsara Eraser 20-pack", 80), ("Camlin Marker 10-pack", 210), ("Fevicol 200g", 62), ("Stapler Medium", 85),
    ("Staple Pins 10-pack", 40), ("Box File A4 3-pack", 270), ("Sticky Notes 12-pack", 150), ("Highlighters 5-pack", 90), ("Geometry Box", 70),
    ("Whiteboard Marker 4-pack", 120), ("Scissors 6 inch", 60), ("Calculator 12-digit", 285), ("Desk Organizer", 340), ("File Folder 10-pack", 160), ("Cello Tape 24-pack", 360),
]
LIFE = [
    ("Dettol Soap 4-pack", 150), ("Lifebuoy Soap 4-pack", 120), ("Dove Shampoo 650ml", 360), ("Clinic Plus Shampoo 340ml", 190), ("Colgate Strong Teeth 500g", 220),
    ("Pepsodent 600g", 190), ("Surf Excel 4kg", 590), ("Ariel Matic 2kg", 440), ("Vim Dishwash Gel 750ml", 130), ("Harpic 1L", 175), ("Lizol 2L", 380),
    ("Good Knight Refill 12-pack", 300), ("Hit Spray 700ml", 190), ("Nivea Cream 200ml", 260), ("Vaseline Lotion 400ml", 280), ("Parachute Coconut Oil 1L", 330),
    ("Bath Towel 2-pack", 520), ("Steel Water Bottle 1L", 140), ("Lunch Box 3-tier", 330), ("Plastic Bucket 20L", 160), ("Door Mat", 130), ("Soft Broom", 140),
]
CATS = [("FOOD_BEVERAGE", FOOD, 5.0), ("ELECTRONICS", ELEC, 1.2), ("OFFICE", OFFICE, 2.2), ("LIFESTYLE", LIFE, 2.5)]
SHORT_LIFE = {"Curd": 12, "Lassi": 60, "Milk": 120, "Butter": 150, "Cheese": 120, "Juice": 180, "Orange": 180}
STORE_SCALE = [1.00, 0.85, 1.15]
DOW = [0.92, 0.90, 0.95, 0.98, 1.12, 1.28, 1.38]       # Mon..Sun


def ean13(body12: str) -> str:
    s = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(body12))
    return body12 + str((10 - s % 10) % 10)


@dataclass
class Product:
    idx: int
    sku: str
    gtin: str
    name: str
    category: str
    cost: float            # base wholesale price
    retail: float
    pack: int
    moq: int
    shelf_life: int | None
    lam: float             # per-store mean daily units (before store scale)
    intermittent: bool
    surge: bool = False
    low_margin: bool = False


def build_catalog(n: int, seed: int) -> list[Product]:
    rng = random.Random(seed)
    pool: list[tuple[str, str, float, float]] = []
    per_cat = [list(items) for _, items, _ in CATS]
    # interleave categories so truncating to n keeps the mix
    longest = max(len(x) for x in per_cat)
    for i in range(longest):
        for ci, (cat, _, base) in enumerate(CATS):
            if i < len(per_cat[ci]):
                name, cost = per_cat[ci][i]
                pool.append((name, cat, float(cost), base))
    while len(pool) < n:        # more SKUs than the hand-written list: add value-pack variants
        name, cat, cost, base = pool[len(pool) % 120]
        pool.append((f"{name} (Value Pack {len(pool)})", cat, round(cost * 1.8, 2), base))
    pool = pool[:n]
    out: list[Product] = []
    for i, (name, cat, cost, base) in enumerate(pool):
        pack = 12 if cost < 80 else 6 if cost < 300 else 4 if cost < 700 else 1
        if cat == "ELECTRONICS" and cost > 800:
            pack = 1
        moq = max(pack * 2, 6)
        shelf = None
        if cat == "FOOD_BEVERAGE":
            shelf = 270
            for k, v in SHORT_LIFE.items():
                if k.lower() in name.lower():
                    shelf = v
        intermittent = rng.random() < 0.15
        lam = base * math.exp(rng.gauss(0, 0.6)) * (0.1 if intermittent else 1.0)
        low_margin = rng.random() < 0.10
        margin = rng.uniform(1.12, 1.17) if low_margin else rng.uniform(1.25, 1.50)
        gtin = ean13("890" + hashlib.sha1(f"{seed}-{i}".encode()).hexdigest()[:9].translate(str.maketrans("abcdef", "012345")))
        out.append(Product(i, f"SKU-{i + 1:04d}", gtin, name, cat, cost, round(cost * margin, 2), pack, moq, shelf, lam, intermittent, False, low_margin))
    # regional-precursor SKUs: busy, non-perishable-ish products
    candidates = [p for p in out if not p.intermittent and p.lam > 2.0]
    for p in rng.sample(candidates, min(10, len(candidates))):
        p.surge = True
    return out


def history(catalog: list[Product], store: int, days: int, end: date, seed: int) -> np.ndarray:
    """(P, days) integer unit sales; the last column is `end` (yesterday). Store 1/2 surge 14 days before store 3 for surge SKUs."""
    rng = np.random.default_rng(seed * 1009 + store)
    P = len(catalog)
    out = np.zeros((P, days), dtype=np.int64)
    dates = [end - timedelta(days=days - 1 - i) for i in range(days)]
    dow = np.array([DOW[d.weekday()] for d in dates])
    for p in catalog:
        trend = 1.0 + np.linspace(-0.10, 0.10, days) * rng.choice([-1, 1])
        promo = np.ones(days)
        for _ in range(2):
            s = int(rng.integers(5, days - 8))
            promo[s:s + int(rng.integers(3, 6))] = 1.6
        mean = p.lam * STORE_SCALE[store] * dow * trend * promo
        if p.surge:
            ramp = np.ones(days)
            if store in (0, 1):                      # early adopters: ramps up over the last 14 days
                ramp[-14:] = np.linspace(1.0, 2.0, 14)
            else:                                    # store 3 only starts moving in the last 2 days
                ramp[-2:] = [1.1, 1.2]
            mean = mean * ramp
        out[p.idx] = rng.poisson(np.maximum(mean, 0))
    return out


def initial_stock(catalog: list[Product], hist: np.ndarray, store: int, seed: int, demo_skus: set[str]) -> dict[str, int]:
    rng = random.Random(seed * 31 + store)
    out = {}
    for p in catalog:
        recent = float(hist[p.idx, -28:].mean())
        if p.sku in demo_skus:
            cover = 9.0                                # just above the reorder point: one busy hour triggers procurement
        elif p.surge:
            cover = 16.0
        else:
            cover = rng.uniform(12, 30)
        out[p.sku] = int(round(max(recent, 0.3) * cover)) + rng.randint(0, 3)
    return out


def pick_demo_skus(catalog: list[Product], hist: list[np.ndarray], per_store: int = 6) -> list[set[str]]:
    """Busy, non-surge, mid-priced SKUs per store (stable for a given seed)."""
    result = []
    used: set[str] = set()
    for s, h in enumerate(hist):
        ranked = sorted((p for p in catalog if not p.surge and not p.intermittent and p.sku not in used and p.cost < 700),
                        key=lambda p: -float(h[p.idx, -28:].mean()))
        chosen = {p.sku for p in ranked[: per_store * 3][::3][:per_store]}
        used |= chosen
        result.append(chosen)
    return result


WHOLESALERS = {
    "WA": dict(name="Kovai Distributors", factor=1.00, lead=2, cover=0.97, max_discount=0.15, mode="ZOHO", ontime=(38, 40), region="Coimbatore"),
    "WB": dict(name="Sri Murugan Wholesale", factor=0.97, lead=3, cover=0.97, max_discount=0.20, mode="PATH_B", ontime=(34, 40), region="Erode"),
    "WC": dict(name="Chennai Bulk Traders", factor=1.03, lead=5, cover=0.85, max_discount=0.25, mode="PATH_B", ontime=(28, 40), region="Chennai"),
}


def wholesaler_catalog(catalog: list[Product], code: str, seed: int, today: date) -> list[dict]:
    w = WHOLESALERS[code]
    rng = random.Random(f"{seed}-{code}")
    items = []
    for p in catalog:
        if rng.random() > w["cover"]:
            continue
        price = round(p.cost * w["factor"] * rng.uniform(0.985, 1.015), 2)
        tiers = [{"minQty": 1, "unitPrice": price}, {"minQty": 48, "unitPrice": round(price * 0.97, 2)}, {"minQty": 120, "unitPrice": round(price * 0.94, 2)}]
        on_hand = int(max(p.lam * 3 * rng.uniform(30, 90), p.moq * 6))
        if rng.random() < 0.04:
            on_hand = int(p.moq * 1.5)                      # scarce item: exercises MOQ / partial-availability paths
        on_hand = max(p.moq, (on_hand // p.pack) * p.pack)
        lots = []
        if p.shelf_life:
            lots = [{"qty": int(on_hand * 0.4), "expiryDays": rng.randint(max(12, p.shelf_life // 5), max(20, p.shelf_life // 2))},
                    {"qty": on_hand - int(on_hand * 0.4), "expiryDays": rng.randint(p.shelf_life // 2 + 5, p.shelf_life)}]
        else:
            lots = [{"qty": int(on_hand * 0.4)}, {"qty": on_hand - int(on_hand * 0.4)}]
        items.append({
            "sku": f"{code}-{p.sku[4:]}", "gtin": p.gtin, "name": p.name, "category": p.category, "uom": "EA", "packSize": p.pack, "moq": p.moq,
            "shelfLifeDays": p.shelf_life, "leadTimeDays": w["lead"] + (1 if rng.random() < 0.15 else 0), "maxDiscountPct": w["max_discount"],
            "tiers": tiers, "lots": lots,
        })
    return items


def pos_catalog(catalog: list[Product], stock: dict[str, int]) -> list[dict]:
    return [{
        "title": p.name, "product_type": p.category, "tags": (f"shelf_life:{p.shelf_life}" if p.shelf_life else ""),
        "sku": p.sku, "barcode": p.gtin, "price": f"{p.retail:.2f}", "cost": f"{p.cost:.2f}", "stock": stock[p.sku],
    } for p in catalog]


def sales_ndjson(catalog: list[Product], hist: np.ndarray, end: date, tenant_id: str) -> str:
    lines = []
    days = hist.shape[1]
    import json
    for p in catalog:
        for d in range(days):
            u = int(hist[p.idx, d])
            if u <= 0:
                continue
            day = end - timedelta(days=days - 1 - d)
            lines.append(json.dumps({"tenantId": tenant_id, "gtin": p.gtin, "day": day.isoformat(), "units": u, "revenue": f"{u * p.retail:.2f}"}))
    return "\n".join(lines)


def digest(catalog: list[Product], hists: list[np.ndarray]) -> str:
    h = hashlib.sha256()
    for p in catalog:
        h.update(f"{p.sku}{p.gtin}{p.cost}{p.retail}".encode())
    for a in hists:
        h.update(a.tobytes())
    return h.hexdigest()[:16]
