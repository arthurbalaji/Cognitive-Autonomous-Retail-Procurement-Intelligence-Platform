/** Internal API used by the POS web UI (cashier terminal). Authenticated with a short-lived signed token (PIN login). */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { cfg } from './config.js';
import { q, tx } from './db.js';
import { adjustLevel, checkout, OutOfStock, shopLocation } from './inventory.js';
import { sha256Hex, signToken, verifyToken } from './util.js';
import type { Shop } from './webhooks.js';

declare module 'fastify' {
  interface FastifyRequest {
    uiShop?: Shop;
    uiUser?: string;
  }
}

export const pinHash = (handle: string, pin: string) => sha256Hex(`${handle}:${pin}`);

async function uiAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = String(req.headers.authorization ?? '');
  const tok = verifyToken(cfg.uiSecret, auth.startsWith('Bearer ') ? auth.slice(7) : undefined);
  const handle = (req.params as any).handle as string;
  if (!tok || (tok.shop !== handle && tok.role !== 'admin')) {
    return void reply.code(401).send({ code: 'UNAUTHORIZED', detail: 'sign in again' });
  }
  const shop = (await q<Shop>('SELECT * FROM shops WHERE handle = $1', [handle]))[0];
  if (!shop) return void reply.code(404).send({ code: 'NOT_FOUND', detail: 'unknown shop' });
  req.uiShop = shop;
  req.uiUser = tok.name;
}

export function registerInternal(app: FastifyInstance): void {
  app.get('/pos/api/shops', async () =>
    q('SELECT handle, name, mode, city, domain FROM shops ORDER BY id'));

  app.post('/pos/api/auth/pin', async (req, reply) => {
    const { shop, pin } = (req.body ?? {}) as { shop?: string; pin?: string };
    if (!shop || !pin) return reply.code(400).send({ code: 'BAD_REQUEST', detail: 'shop and pin required' });
    const rows = await q<any>('SELECT u.id, u.name, u.role FROM users u JOIN shops s ON s.id = u.shop_id WHERE s.handle = $1 AND u.pin_hash = $2', [shop, pinHash(shop, pin)]);
    if (!rows[0]) return reply.code(401).send({ code: 'INVALID_PIN', detail: 'wrong PIN' });
    return { token: signToken(cfg.uiSecret, { shop, name: rows[0].name, role: rows[0].role }), user: rows[0].name, shop };
  });

  app.register(async (s) => {
    s.addHook('preHandler', uiAuth);

    s.get('/pos/api/shops/:handle/products', async (req) => {
      const qs = req.query as any;
      const term = qs.q ? `%${String(qs.q).toLowerCase()}%` : null;
      return q<any>(
        `SELECT v.sku, v.barcode, p.title, p.product_type AS category, v.price, COALESCE(l.available,0) AS available, v.inventory_item_id
         FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN inventory_levels l ON l.inventory_item_id = v.inventory_item_id
         WHERE v.shop_id = $1 AND ($2::text IS NULL OR lower(p.title) LIKE $2 OR lower(v.sku) LIKE $2 OR v.barcode = $3)
         ORDER BY p.title LIMIT 400`, [req.uiShop!.id, term, qs.q ?? null]);
    });

    s.post('/pos/api/shops/:handle/checkout', async (req, reply) => {
      const b = (req.body ?? {}) as { items?: { sku: string; qty: number }[] };
      try {
        return await checkout(req.uiShop!, b.items ?? [], req.uiUser ?? 'cashier');
      } catch (e: any) {
        if (e instanceof OutOfStock) return reply.code(409).send({ code: 'OUT_OF_STOCK', detail: e.message, sku: e.sku, available: e.available });
        if (e.statusCode === 404) return reply.code(404).send({ code: 'UNKNOWN_SKU', detail: e.message });
        if (/invalid quantity|cart is empty/.test(e.message)) return reply.code(400).send({ code: 'BAD_REQUEST', detail: e.message });
        throw e;
      }
    });

    s.get('/pos/api/shops/:handle/orders', async (req) =>
      q<any>(`SELECT o.id, o.order_number, o.total, o.cashier, o.created_at,
                     (SELECT json_agg(json_build_object('sku', l.sku, 'title', l.title, 'quantity', l.quantity, 'price', l.price) ORDER BY l.id) FROM order_line_items l WHERE l.order_id = o.id) AS lines
              FROM orders o WHERE o.shop_id = $1 ORDER BY o.id DESC LIMIT 60`, [req.uiShop!.id]));

    s.get('/pos/api/shops/:handle/incoming', async (req) =>
      q<any>('SELECT po_number, supplier, status, eta, lines, updated_at FROM incoming_purchase_orders WHERE shop_id=$1 ORDER BY updated_at DESC LIMIT 60', [req.uiShop!.id]));

    s.get('/pos/api/shops/:handle/summary', async (req) => {
      const id = req.uiShop!.id;
      const today = (await q<any>(`SELECT count(*)::int AS orders, COALESCE(sum(total),0) AS revenue FROM orders WHERE shop_id=$1 AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`, [id]))[0];
      const low = await q<any>(`SELECT v.sku, p.title, l.available FROM variants v JOIN products p ON p.id=v.product_id JOIN inventory_levels l ON l.inventory_item_id=v.inventory_item_id
                                 WHERE v.shop_id=$1 ORDER BY l.available ASC LIMIT 6`, [id]);
      const del = (await q<any>(`SELECT count(*) FILTER (WHERE status='PENDING')::int AS pending, count(*) FILTER (WHERE status='FAILED')::int AS failed, count(*) FILTER (WHERE status='DELIVERED')::int AS delivered FROM webhook_deliveries WHERE shop_id=$1`, [id]))[0];
      return { shop: { handle: req.uiShop!.handle, name: (req.uiShop as any).name, mode: req.uiShop!.mode }, today, lowStock: low, deliveries: del };
    });

    s.get('/pos/api/shops/:handle/integration-log', async (req) => {
      const id = req.uiShop!.id;
      return {
        deliveries: await q<any>(`SELECT id, kind, topic, address, status, attempts, last_status_code, last_error, triggered_at, delivered_at, next_attempt_at
                                   FROM webhook_deliveries WHERE shop_id=$1 ORDER BY id DESC LIMIT 80`, [id]),
        apiLog: await q<any>('SELECT direction, method, path, status, note, at FROM api_log WHERE shop_id=$1 ORDER BY id DESC LIMIT 80', [id]),
        subscriptions: await q<any>('SELECT topic, address FROM webhook_subscriptions WHERE shop_id=$1 ORDER BY id', [id]),
        carpip: { linked: !!req.uiShop!.carpip_base_url || (await q('SELECT 1 FROM webhook_subscriptions WHERE shop_id=$1 LIMIT 1', [id])).length > 0, mode: req.uiShop!.mode },
      };
    });

    s.post('/pos/api/shops/:handle/deliveries/:id/retry', async (req) => {
      const n = await q('UPDATE webhook_deliveries SET status=\'PENDING\', attempts=0, next_attempt_at=now() WHERE id=$1 AND shop_id=$2 AND status=\'FAILED\' RETURNING id',
        [Number((req.params as any).id), req.uiShop!.id]);
      return { requeued: n.length };
    });

    s.post('/pos/api/shops/:handle/adjust', async (req, reply) => {
      const b = (req.body ?? {}) as { sku?: string; delta?: number; reason?: string };
      if (!b.sku || !Number.isInteger(b.delta) || b.delta === 0) return reply.code(400).send({ code: 'BAD_REQUEST', detail: 'sku and non-zero integer delta required' });
      const v = (await q<any>('SELECT inventory_item_id FROM variants WHERE shop_id=$1 AND sku=$2', [req.uiShop!.id, b.sku]))[0];
      if (!v) return reply.code(404).send({ code: 'UNKNOWN_SKU', detail: b.sku });
      try {
        return await tx(async (c) => adjustLevel(c, req.uiShop!, v.inventory_item_id, await shopLocation(c, req.uiShop!.id), b.delta!, b.reason ?? 'MANUAL', null, null, false));
      } catch (e: any) {
        if (e instanceof OutOfStock) return reply.code(409).send({ code: 'OUT_OF_STOCK', detail: e.message });
        throw e;
      }
    });
  });
}
