import type pg from 'pg';
import { q, tx } from './db.js';
import { enqueueLegacyPush, enqueueWebhook, type Shop } from './webhooks.js';
import { fromCents, toCents } from './util.js';

export class OutOfStock extends Error {
  constructor(public sku: string, public available: number, public wanted: number) {
    super(`OUT_OF_STOCK: ${sku} has ${available}, wanted ${wanted}`);
  }
}

export interface LevelResult {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
  duplicate?: boolean;
}

export async function shopLocation(client: pg.PoolClient | undefined, shopId: number): Promise<number> {
  const r = await q<{ id: number }>('SELECT id FROM locations WHERE shop_id = $1 ORDER BY id LIMIT 1', [shopId], client);
  if (!r[0]) throw new Error('shop has no location');
  return r[0].id;
}

/** Notify CARPIP of an absolute stock level: Shopify-style webhook, or a legacy REST push (non-canonical payload). */
export async function publishLevel(client: pg.PoolClient, shop: Shop, itemId: number, locationId: number, available: number, updatedAt: Date): Promise<void> {
  if (shop.mode === 'SHOPIFY') {
    await enqueueWebhook(client, shop, 'inventory_levels/update', {
      inventory_item_id: itemId, location_id: locationId, available, updated_at: updatedAt.toISOString(),
    }, updatedAt);
    return;
  }
  const v = await q<any>(
    `SELECT v.sku, v.barcode, v.price, p.title, p.product_type, i.cost FROM variants v JOIN products p ON p.id = v.product_id
     JOIN inventory_items i ON i.id = v.inventory_item_id WHERE v.inventory_item_id = $1`, [itemId], client);
  if (!v[0]) return;
  const x = v[0];
  await enqueueLegacyPush(client, shop, '/api/v1/inventory', {
    batchId: `inv-${itemId}-${updatedAt.getTime()}`,
    items: [{ item_code: x.sku, name: x.title, category: x.product_type, barcode: x.barcode, price: x.price, cost: x.cost, qty: available, ts: updatedAt.toISOString() }],
  }, 'inventory');
}

/**
 * Atomic, race-safe stock change. The conditional UPDATE is the concurrency guard: two checkouts racing for the last
 * unit cannot both succeed.  `updated_at` is strictly increasing per level (>= previous + 1ms) because CARPIP uses it as a
 * version to discard stale/out-of-order updates.  An idempotency key makes retries harmless (no double receipt).
 */
export async function adjustLevel(client: pg.PoolClient, shop: Shop, itemId: number, locationId: number, delta: number, reason: string,
                                  reference: string | null, idemKey: string | null, allowNegative = false): Promise<LevelResult> {
  if (idemKey) {
    const prev = await q<any>('SELECT result_available, at FROM inventory_adjustments WHERE idempotency_key = $1', [idemKey], client);
    if (prev[0]) {
      const lv = await q<any>('SELECT available, updated_at FROM inventory_levels WHERE inventory_item_id=$1 AND location_id=$2', [itemId, locationId], client);
      return { inventory_item_id: itemId, location_id: locationId, available: lv[0].available, updated_at: new Date(lv[0].updated_at).toISOString(), duplicate: true };
    }
  }
  const rows = await q<any>(
    `UPDATE inventory_levels SET available = available + $3, version = version + 1,
            updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond')
     WHERE inventory_item_id = $1 AND location_id = $2 AND ($4::boolean OR available + $3 >= 0)
     RETURNING available, updated_at`, [itemId, locationId, delta, allowNegative], client);
  if (!rows[0]) {
    const cur = await q<any>('SELECT available FROM inventory_levels WHERE inventory_item_id=$1 AND location_id=$2', [itemId, locationId], client);
    const sku = (await q<any>('SELECT sku FROM inventory_items WHERE id=$1', [itemId], client))[0]?.sku ?? String(itemId);
    throw new OutOfStock(sku, cur[0]?.available ?? 0, -delta);
  }
  const lv = rows[0];
  await q(`INSERT INTO inventory_adjustments(inventory_item_id, location_id, delta, reason, reference, idempotency_key, result_available) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [itemId, locationId, delta, reason, reference, idemKey, lv.available], client);
  await publishLevel(client, shop, itemId, locationId, lv.available, new Date(lv.updated_at));
  return { inventory_item_id: itemId, location_id: locationId, available: lv.available, updated_at: new Date(lv.updated_at).toISOString() };
}

export async function setLevel(client: pg.PoolClient, shop: Shop, itemId: number, locationId: number, available: number, reason: string): Promise<LevelResult> {
  const rows = await q<any>(
    `UPDATE inventory_levels SET available = $3, version = version + 1,
            updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond')
     WHERE inventory_item_id = $1 AND location_id = $2 RETURNING available, updated_at`, [itemId, locationId, available], client);
  if (!rows[0]) throw new Error('inventory level not found');
  await q(`INSERT INTO inventory_adjustments(inventory_item_id, location_id, delta, reason, result_available) VALUES ($1,$2,0,$3,$4)`, [itemId, locationId, reason, available], client);
  await publishLevel(client, shop, itemId, locationId, available, new Date(rows[0].updated_at));
  return { inventory_item_id: itemId, location_id: locationId, available: rows[0].available, updated_at: new Date(rows[0].updated_at).toISOString() };
}

/** A business-rule failure the HTTP layer maps to a status code + machine-readable code. */
export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export interface NewProduct {
  sku: string;
  title: string;
  product_type?: string | null;
  barcode?: string | null;
  price: string | number;
  cost?: string | number | null;
  stock?: number;
  tags?: string;
}

/**
 * Creates product + variant + inventory item + stock level in the caller's transaction (shared by the admin catalog loader and the
 * cashier "add product" screen). The opening level is always published, so CARPIP learns about the new item right away: a Shopify
 * shop also announces `products/update` (CARPIP then re-syncs the catalog), a legacy shop's REST push carries the product name.
 */
export async function createProduct(c: pg.PoolClient, shop: Shop, p: NewProduct, publish = true): Promise<{ sku: string; inventory_item_id: number }> {
  if ((await q('SELECT 1 FROM variants WHERE shop_id=$1 AND sku=$2', [shop.id, p.sku], c)).length) {
    throw new HttpError(409, 'DUPLICATE_SKU', `SKU ${p.sku} already exists`);
  }
  if (publish && p.barcode && (await q('SELECT 1 FROM variants WHERE shop_id=$1 AND barcode=$2', [shop.id, p.barcode], c)).length) {
    throw new HttpError(409, 'DUPLICATE_BARCODE', `barcode ${p.barcode} already belongs to another product`);
  }
  const loc = await shopLocation(c, shop.id);
  const prod = (await q<any>('INSERT INTO products(shop_id, title, product_type, tags) VALUES ($1,$2,$3,$4) RETURNING id', [shop.id, p.title, p.product_type ?? null, p.tags ?? ''], c))[0];
  const ii = (await q<any>('INSERT INTO inventory_items(shop_id, sku, cost) VALUES ($1,$2,$3) RETURNING id', [shop.id, p.sku, p.cost ?? null], c))[0];
  await q('INSERT INTO variants(product_id, shop_id, sku, barcode, price, inventory_item_id) VALUES ($1,$2,$3,$4,$5,$6)', [prod.id, shop.id, p.sku, p.barcode ?? null, p.price, ii.id], c);
  await q(`INSERT INTO inventory_levels(inventory_item_id, location_id, available, updated_at) VALUES ($1,$2,0, now() - interval '1 hour')`, [ii.id, loc], c);
  if (publish) {
    await setLevel(c, shop, ii.id, loc, p.stock ?? 0, 'OPENING_STOCK');
    if (shop.mode === 'SHOPIFY') {
      await enqueueWebhook(c, shop, 'products/update', { id: prod.id, title: p.title, product_type: p.product_type ?? null, updated_at: new Date().toISOString() });
    }
  } else if (p.stock) {
    await q('UPDATE inventory_levels SET available=$3 WHERE inventory_item_id=$1 AND location_id=$2', [ii.id, loc, p.stock], c);
  }
  return { sku: p.sku, inventory_item_id: ii.id };
}

export interface PurchaseLineIn { sku: string; qty: number; unitCost: string | number }

/** One purchase bill = one transaction: header + lines + stock-in per SKU (race-safe `adjustLevel`, so CARPIP is told of every new level). */
export async function recordPurchase(shop: Shop, b: { supplier: string; invoiceNo: string; invoiceDate?: string; lines: PurchaseLineIn[] }, user: string): Promise<any> {
  const merged = new Map<string, { qty: number; costCents: number }>();
  for (const l of b.lines) {
    if (!l.sku || !Number.isInteger(l.qty) || l.qty <= 0) throw new HttpError(400, 'BAD_REQUEST', `invalid quantity for ${l.sku || 'line'}`);
    const cost = toCents(l.unitCost);
    if (!Number.isFinite(cost) || cost < 0) throw new HttpError(400, 'BAD_REQUEST', `invalid unit cost for ${l.sku}`);
    const cur = merged.get(l.sku);
    if (cur) { cur.qty += l.qty; cur.costCents = cost; } else merged.set(l.sku, { qty: l.qty, costCents: cost });
  }
  if (!merged.size) throw new HttpError(400, 'BAD_REQUEST', 'a purchase needs at least one line');
  return tx(async (c) => {
    if ((await q('SELECT 1 FROM purchases WHERE shop_id=$1 AND supplier=$2 AND invoice_no=$3', [shop.id, b.supplier, b.invoiceNo], c)).length) {
      throw new HttpError(409, 'DUPLICATE_INVOICE', `invoice ${b.invoiceNo} from ${b.supplier} is already recorded`);
    }
    const loc = await shopLocation(c, shop.id);
    const skus = [...merged.keys()].sort(); // fixed lock order, same rule as checkout
    let totalCents = 0;
    const resolved: { sku: string; title: string; itemId: number; qty: number; costCents: number }[] = [];
    for (const sku of skus) {
      const v = (await q<any>('SELECT v.inventory_item_id, p.title FROM variants v JOIN products p ON p.id=v.product_id WHERE v.shop_id=$1 AND v.sku=$2', [shop.id, sku], c))[0];
      if (!v) throw new HttpError(404, 'UNKNOWN_SKU', `unknown SKU ${sku}`);
      const m = merged.get(sku)!;
      resolved.push({ sku, title: v.title, itemId: v.inventory_item_id, qty: m.qty, costCents: m.costCents });
      totalCents += m.qty * m.costCents;
    }
    const head = (await q<any>(`INSERT INTO purchases(shop_id, supplier, invoice_no, invoice_date, total, created_by) VALUES ($1,$2,$3,COALESCE($4::date, current_date),$5,$6) RETURNING id, invoice_date, created_at`,
      [shop.id, b.supplier, b.invoiceNo, b.invoiceDate ?? null, fromCents(totalCents), user], c))[0];
    for (const r of resolved) {
      await q('INSERT INTO purchase_lines(purchase_id, sku, title, quantity, unit_cost) VALUES ($1,$2,$3,$4,$5)', [head.id, r.sku, r.title, r.qty, fromCents(r.costCents)], c);
      await q('UPDATE inventory_items SET cost=$2 WHERE id=$1', [r.itemId, fromCents(r.costCents)], c); // latest purchase cost
      await adjustLevel(c, shop, r.itemId, loc, r.qty, 'PURCHASE', b.invoiceNo, `purchase:${head.id}:${r.sku}`);
    }
    return { id: head.id, supplier: b.supplier, invoice_no: b.invoiceNo, invoice_date: head.invoice_date, total: fromCents(totalCents), lines: resolved.length };
  });
}

export interface CartItem { sku: string; qty: number }

/** One transaction: stock decrement(s) + order + order webhook(s). Rolls back everything if any line is out of stock. */
export async function checkout(shop: Shop, items: CartItem[], cashier: string): Promise<any> {
  if (!items.length) throw new Error('cart is empty');
  const merged = new Map<string, number>();
  for (const it of items) {
    if (!Number.isInteger(it.qty) || it.qty <= 0) throw new Error(`invalid quantity for ${it.sku}`);
    merged.set(it.sku, (merged.get(it.sku) ?? 0) + it.qty);
  }
  return tx(async (c) => {
    const loc = await shopLocation(c, shop.id);
    const lines: any[] = [];
    let totalCents = 0;
    const skus = [...merged.keys()].sort(); // fixed lock order avoids deadlocks between concurrent carts
    for (const sku of skus) {
      const qty = merged.get(sku)!;
      const v = (await q<any>(`SELECT v.id, v.sku, v.price, v.inventory_item_id, p.title FROM variants v JOIN products p ON p.id = v.product_id WHERE v.shop_id=$1 AND v.sku=$2`, [shop.id, sku], c))[0];
      if (!v) throw Object.assign(new Error(`UNKNOWN_SKU: ${sku}`), { statusCode: 404 });
      await adjustLevel(c, shop, v.inventory_item_id, loc, -qty, 'SALE', null, null, shop.allow_oversell);
      lines.push({ variant_id: v.id, sku: v.sku, title: v.title, quantity: qty, price: v.price });
      totalCents += toCents(v.price) * qty;
    }
    const num = (await q<any>('SELECT COALESCE(MAX(order_number),1000)+1 AS n FROM orders WHERE shop_id=$1', [shop.id], c))[0].n;
    const o = (await q<any>(`INSERT INTO orders(shop_id, order_number, total, cashier) VALUES ($1,$2,$3,$4) RETURNING id, created_at, updated_at`, [shop.id, num, fromCents(totalCents), cashier], c))[0];
    for (const l of lines) {
      const r = await q<any>(`INSERT INTO order_line_items(order_id, variant_id, sku, title, quantity, price) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [o.id, l.variant_id, l.sku, l.title, l.quantity, l.price], c);
      l.id = r[0].id;
    }
    if (shop.mode === 'SHOPIFY') {
      await enqueueWebhook(c, shop, 'orders/create', {
        id: o.id, order_number: num, created_at: new Date(o.created_at).toISOString(), updated_at: new Date(o.updated_at).toISOString(),
        currency: 'INR', total_price: fromCents(totalCents), location_id: loc,
        line_items: lines.map((l) => ({ id: l.id, variant_id: l.variant_id, sku: l.sku, title: l.title, quantity: l.quantity, price: l.price })),
      }, new Date(o.created_at));
    } else {
      await enqueueLegacyPush(c, shop, '/api/v1/orders', {
        orderId: String(o.id), occurredAt: new Date(o.created_at).toISOString(), adjustStock: false,
        lines: lines.map((l) => ({ lineId: String(l.id), item_code: l.sku, qty: l.quantity, unitPrice: l.price })),
      }, 'order');
    }
    return { id: o.id, order_number: num, total: fromCents(totalCents), lines, created_at: new Date(o.created_at).toISOString() };
  });
}
