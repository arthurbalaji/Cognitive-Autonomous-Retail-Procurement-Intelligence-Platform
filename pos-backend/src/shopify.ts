/**
 * Shopify Admin REST API (2024-01) mimic - the surface CARPIP's ShopifyAdapter talks to.
 * Shop is resolved from the Host header (docker network aliases store-N.myshopify.local) and must match X-Shopify-Access-Token.
 * Documented non-Shopify extensions: POST purchase_orders.json (incoming stock) and the X-Carpip-Idempotency-Key header on adjust.json.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { q, tx } from './db.js';
import { adjustLevel, OutOfStock, setLevel } from './inventory.js';
import { sha256Hex, safeEq } from './util.js';
import type { Shop } from './webhooks.js';

const API = '/admin/api/2024-01';

// leaky bucket: capacity 40, leaks 2 calls/second (Shopify REST standard plan)
const buckets = new Map<string, { level: number; ts: number }>();
function bucket(key: string): { used: number; limited: boolean } {
  const now = Date.now();
  const b = buckets.get(key) ?? { level: 0, ts: now };
  b.level = Math.max(0, b.level - ((now - b.ts) / 1000) * 2);
  b.ts = now;
  if (b.level + 1 > 40) {
    buckets.set(key, b);
    return { used: Math.ceil(b.level), limited: true };
  }
  b.level += 1;
  buckets.set(key, b);
  return { used: Math.ceil(b.level), limited: false };
}

declare module 'fastify' {
  interface FastifyRequest {
    shop?: Shop;
  }
}

async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const host = (req.headers.host ?? '').split(':')[0].toLowerCase();
  const token = String(req.headers['x-shopify-access-token'] ?? '');
  const rows = await q<any>('SELECT * FROM shops WHERE domain = $1', [host]);
  const shop = rows[0];
  if (!shop || !token || !safeEq(sha256Hex(token), shop.access_token_hash)) {
    await q(`INSERT INTO api_log(shop_id, direction, method, path, status, note) VALUES ($1,'IN',$2,$3,401,'bad token or unknown shop')`, [shop?.id ?? null, req.method, req.url.slice(0, 200)]);
    return void reply.code(401).send({ errors: '[API] Invalid API key or access token (unrecognized login or wrong password)' });
  }
  const b = bucket(`${shop.id}`);
  reply.header('X-Shopify-Shop-Api-Call-Limit', `${b.used}/40`);
  if (b.limited) {
    return void reply.code(429).header('Retry-After', '1.0').send({ errors: 'Exceeded 2 calls per second for api client. Reduce request rates to resume uninterrupted service.' });
  }
  req.shop = shop;
}

const variantJson = (v: any, qty: number) => ({
  id: v.id, product_id: v.product_id, title: v.title, sku: v.sku, barcode: v.barcode, price: v.price,
  inventory_item_id: v.inventory_item_id, inventory_quantity: qty, inventory_management: 'shopify', created_at: new Date(v.created_at).toISOString(),
  updated_at: new Date(v.updated_at).toISOString(),
});

async function productsPage(shop: Shop, opts: { sinceId: number; limit: number; ids?: number[]; updatedAtMin?: string }) {
  const params: any[] = [shop.id, opts.sinceId, opts.limit];
  let extra = '';
  if (opts.ids?.length) {
    params.push(opts.ids);
    extra += ` AND p.id = ANY($${params.length}::bigint[])`;
  }
  if (opts.updatedAtMin) {
    params.push(opts.updatedAtMin);
    extra += ` AND p.updated_at >= $${params.length}::timestamptz`;
  }
  const prods = await q<any>(`SELECT * FROM products p WHERE p.shop_id = $1 AND p.id > $2 ${extra} ORDER BY p.id LIMIT $3`, params);
  if (!prods.length) return [];
  const vs = await q<any>(
    `SELECT v.*, COALESCE((SELECT SUM(available) FROM inventory_levels l WHERE l.inventory_item_id = v.inventory_item_id),0)::int AS qty
     FROM variants v WHERE v.product_id = ANY($1::bigint[]) ORDER BY v.id`, [prods.map((p: any) => p.id)]);
  return prods.map((p: any) => ({
    id: p.id, title: p.title, product_type: p.product_type, tags: p.tags, status: 'active', created_at: new Date(p.created_at).toISOString(),
    updated_at: new Date(p.updated_at).toISOString(),
    variants: vs.filter((v: any) => v.product_id === p.id).map((v: any) => variantJson(v, v.qty)),
  }));
}

export function registerShopify(app: FastifyInstance): void {
  app.register(async (s) => {
    s.addHook('preHandler', authenticate);

    s.get(`${API}/shop.json`, async (req) => {
      const sh = req.shop!;
      return { shop: { id: sh.id, name: (sh as any).name, domain: sh.domain, myshopify_domain: sh.domain, currency: 'INR', timezone: 'Asia/Kolkata', plan_name: 'basic' } };
    });

    s.get(`${API}/locations.json`, async (req) => ({
      locations: (await q<any>('SELECT id, name FROM locations WHERE shop_id=$1 ORDER BY id', [req.shop!.id])).map((l) => ({ ...l, active: true })),
    }));

    s.get(`${API}/products.json`, async (req, reply) => {
      const qs = req.query as Record<string, string>;
      let sinceId = Number(qs.since_id ?? 0);
      let limit = Math.min(Math.max(Number(qs.limit ?? 50), 1), 250);
      let ids: number[] | undefined = qs.ids ? qs.ids.split(',').map(Number) : undefined;
      let updatedAtMin = qs.updated_at_min;
      if (qs.page_info) {
        try {
          const c = JSON.parse(Buffer.from(qs.page_info, 'base64url').toString());
          sinceId = c.since_id; limit = c.limit; ids = c.ids; updatedAtMin = c.updated_at_min;
        } catch {
          return reply.code(400).send({ errors: 'Invalid page_info' });
        }
      }
      const products = await productsPage(req.shop!, { sinceId, limit, ids, updatedAtMin });
      if (products.length === limit) {
        const cursor = Buffer.from(JSON.stringify({ since_id: products[products.length - 1].id, limit, ids, updated_at_min: updatedAtMin })).toString('base64url');
        const proto = (req.headers['x-forwarded-proto'] as string) ?? 'http';
        reply.header('Link', `<${proto}://${req.headers.host}${API}/products.json?limit=${limit}&page_info=${cursor}>; rel="next"`);
      }
      return { products };
    });

    s.get(`${API}/products/:id.json`, async (req, reply) => {
      const id = Number((req.params as any).id);
      const [p] = await productsPage(req.shop!, { sinceId: id - 1, limit: 1, ids: [id] });
      return p ? { product: p } : reply.code(404).send({ errors: 'Not Found' });
    });

    s.get(`${API}/inventory_items.json`, async (req) => {
      const ids = String((req.query as any).ids ?? '').split(',').filter(Boolean).map(Number);
      if (!ids.length) return { inventory_items: [] };
      return { inventory_items: await q<any>('SELECT id, sku, cost, tracked FROM inventory_items WHERE shop_id=$1 AND id = ANY($2::bigint[]) ORDER BY id LIMIT 250', [req.shop!.id, ids]) };
    });

    s.get(`${API}/inventory_levels.json`, async (req) => {
      const qs = req.query as any;
      const ids = String(qs.inventory_item_ids ?? '').split(',').filter(Boolean).map(Number);
      const rows = await q<any>(
        `SELECT l.inventory_item_id, l.location_id, l.available, l.updated_at FROM inventory_levels l JOIN inventory_items i ON i.id = l.inventory_item_id
         WHERE i.shop_id = $1 ${ids.length ? 'AND l.inventory_item_id = ANY($2::bigint[])' : ''} ORDER BY l.inventory_item_id LIMIT 250`,
        ids.length ? [req.shop!.id, ids] : [req.shop!.id]);
      return { inventory_levels: rows.map((r) => ({ ...r, updated_at: new Date(r.updated_at).toISOString() })) };
    });

    s.post(`${API}/inventory_levels/adjust.json`, async (req, reply) => {
      const b = req.body as any;
      const itemId = Number(b?.inventory_item_id);
      const loc = Number(b?.location_id);
      const delta = Number(b?.available_adjustment);
      if (!itemId || !loc || !Number.isInteger(delta)) return reply.code(422).send({ errors: 'inventory_item_id, location_id and integer available_adjustment are required' });
      const own = await q('SELECT 1 FROM inventory_items WHERE id=$1 AND shop_id=$2', [itemId, req.shop!.id]);
      if (!own.length) return reply.code(404).send({ errors: 'Not Found' });
      try {
        const key = (req.headers['x-carpip-idempotency-key'] as string | undefined) ?? null;
        const lv = await tx((c) => adjustLevel(c, req.shop!, itemId, loc, delta, key ? 'CARPIP_RECEIPT' : 'API_ADJUST', key, key, req.shop!.allow_oversell));
        return { inventory_level: lv };
      } catch (e: any) {
        if (e instanceof OutOfStock) return reply.code(422).send({ errors: e.message });
        throw e;
      }
    });

    s.post(`${API}/inventory_levels/set.json`, async (req, reply) => {
      const b = req.body as any;
      const itemId = Number(b?.inventory_item_id);
      const loc = Number(b?.location_id);
      const available = Number(b?.available);
      if (!itemId || !loc || !Number.isInteger(available) || available < 0) return reply.code(422).send({ errors: 'inventory_item_id, location_id and available >= 0 required' });
      const own = await q('SELECT 1 FROM inventory_items WHERE id=$1 AND shop_id=$2', [itemId, req.shop!.id]);
      if (!own.length) return reply.code(404).send({ errors: 'Not Found' });
      return { inventory_level: await tx((c) => setLevel(c, req.shop!, itemId, loc, available, 'API_SET')) };
    });

    s.get(`${API}/orders.json`, async (req) => {
      const qs = req.query as any;
      const params: any[] = [req.shop!.id, Math.min(Number(qs.limit ?? 50), 250)];
      let extra = '';
      if (qs.updated_at_min) { params.push(qs.updated_at_min); extra += ` AND o.updated_at >= $${params.length}::timestamptz`; }
      if (qs.since_id) { params.push(Number(qs.since_id)); extra += ` AND o.id > $${params.length}`; }
      const orders = await q<any>(`SELECT * FROM orders o WHERE o.shop_id = $1 ${extra} ORDER BY o.id LIMIT $2`, params);
      if (!orders.length) return { orders: [] };
      const lines = await q<any>('SELECT * FROM order_line_items WHERE order_id = ANY($1::bigint[]) ORDER BY id', [orders.map((o: any) => o.id)]);
      return {
        orders: orders.map((o: any) => ({
          id: o.id, order_number: o.order_number, created_at: new Date(o.created_at).toISOString(), updated_at: new Date(o.updated_at).toISOString(),
          total_price: o.total, currency: o.currency, financial_status: o.status,
          line_items: lines.filter((l: any) => l.order_id === o.id).map((l: any) => ({ id: l.id, variant_id: l.variant_id, sku: l.sku, title: l.title, quantity: l.quantity, price: l.price })),
        })),
      };
    });

    s.get(`${API}/webhooks.json`, async (req) => ({
      webhooks: (await q<any>('SELECT id, topic, address, format FROM webhook_subscriptions WHERE shop_id=$1 ORDER BY id', [req.shop!.id])),
    }));

    s.post(`${API}/webhooks.json`, async (req, reply) => {
      const w = (req.body as any)?.webhook;
      if (!w?.topic || !w?.address) return reply.code(422).send({ errors: { topic: ['is required'], address: ['is required'] } });
      const rows = await q<any>(
        `INSERT INTO webhook_subscriptions(shop_id, topic, address, format) VALUES ($1,$2,$3,$4)
         ON CONFLICT (shop_id, topic, address) DO UPDATE SET format = EXCLUDED.format RETURNING id, topic, address, format`,
        [req.shop!.id, w.topic, w.address, w.format ?? 'json']);
      return reply.code(201).send({ webhook: rows[0] });
    });

    s.delete(`${API}/webhooks/:id.json`, async (req, reply) => {
      await q('DELETE FROM webhook_subscriptions WHERE id=$1 AND shop_id=$2', [Number((req.params as any).id), req.shop!.id]);
      return reply.code(200).send({});
    });

    // ---- documented extension: incoming purchase orders (real Shopify has no PO API for merchants)
    s.post(`${API}/purchase_orders.json`, async (req, reply) => {
      const po = (req.body as any)?.purchase_order;
      if (!po?.po_number || !po?.status) return reply.code(422).send({ errors: 'po_number and status are required' });
      await q(
        `INSERT INTO incoming_purchase_orders(shop_id, po_number, supplier, status, eta, currency, lines)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT (shop_id, po_number) DO UPDATE SET supplier=EXCLUDED.supplier, status=EXCLUDED.status, eta=EXCLUDED.eta, lines=EXCLUDED.lines, updated_at=now()`,
        [req.shop!.id, po.po_number, po.supplier ?? null, po.status, po.eta ?? null, po.currency ?? 'INR', JSON.stringify(po.line_items ?? [])]);
      await q(`INSERT INTO api_log(shop_id, direction, method, path, status, note) VALUES ($1,'IN','POST',$2,201,$3)`, [req.shop!.id, 'purchase_orders.json', `${po.po_number} -> ${po.status}`]);
      return reply.code(201).send({ purchase_order: { po_number: po.po_number, status: po.status } });
    });

    s.get(`${API}/purchase_orders.json`, async (req) => ({
      purchase_orders: await q<any>('SELECT po_number, supplier, status, eta, lines AS line_items, updated_at FROM incoming_purchase_orders WHERE shop_id=$1 ORDER BY updated_at DESC', [req.shop!.id]),
    }));
  });
}
