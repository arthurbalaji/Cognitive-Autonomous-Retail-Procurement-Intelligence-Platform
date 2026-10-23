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
