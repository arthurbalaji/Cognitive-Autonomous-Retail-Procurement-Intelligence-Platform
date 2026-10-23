/**
 * Legacy store (Path B): CARPIP calls back with CARPIP-signed requests.
 *   GET  /legacy/health            signed ping used by CARPIP's "test connection"
 *   POST /legacy/carpip/callback   purchase_order.status (incoming stock notices) and stock.receipt (goods received)
 * Scheme: X-Carpip-Signature: v1=hex(HMAC_SHA256(secret, timestamp.eventId.rawBody)), +-300s window.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { q, tx } from './db.js';
import { adjustLevel, shopLocation } from './inventory.js';
import { carpipVerify } from './util.js';
import type { Shop } from './webhooks.js';

async function verified(req: FastifyRequest): Promise<Shop | null> {
  const tenant = String(req.headers['x-carpip-tenant'] ?? '');
  const shop = (await q<Shop>('SELECT * FROM shops WHERE carpip_tenant_public_id = $1 AND mode = $2', [tenant, 'LEGACY']))[0];
  if (!shop) return null;
  const raw = ((req as any).rawBody as Buffer | undefined) ?? Buffer.alloc(0);
  const ok = carpipVerify(shop.webhook_secret, req.headers['x-carpip-signature'] as string, req.headers['x-carpip-timestamp'] as string,
    req.headers['x-carpip-event-id'] as string, raw);
  return ok ? shop : null;
}

export function registerLegacy(app: FastifyInstance): void {
  app.get('/legacy/health', async (req, reply) => {
    const shop = await verified(req);
    if (!shop) return reply.code(401).send({ error: 'invalid signature' });
    return { ok: true, system: 'legacy-pos', shop: shop.handle };
  });

  app.post('/legacy/carpip/callback', async (req, reply) => {
    const shop = await verified(req);
    if (!shop) {
      await q(`INSERT INTO api_log(direction, method, path, status, note) VALUES ('IN','POST','/legacy/carpip/callback',401,'invalid CARPIP signature')`);
      return reply.code(401).send({ error: 'invalid signature' });
    }
    const b = (req.body ?? {}) as any;
    if (b.event === 'purchase_order.status') {
      const lines = [{ sku: b.sku, title: b.name, quantity_ordered: b.quantityOrdered, quantity_expected: b.quantityExpected, quantity_shipped: b.quantityShipped, unit_cost: b.unitCost }];
      await q(
        `INSERT INTO incoming_purchase_orders(shop_id, po_number, supplier, status, eta, lines) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (shop_id, po_number) DO UPDATE SET supplier=EXCLUDED.supplier, status=EXCLUDED.status, eta=EXCLUDED.eta, lines=EXCLUDED.lines, updated_at=now()`,
        [shop.id, b.poNumber, b.supplierName ?? null, b.status, b.eta ?? null, JSON.stringify(lines)]);
      await q(`INSERT INTO api_log(shop_id, direction, method, path, status, note) VALUES ($1,'IN','POST','/legacy/carpip/callback',200,$2)`, [shop.id, `${b.poNumber} -> ${b.status}`]);
      return { accepted: true };
    }
    if (b.event === 'stock.receipt') {
      const qty = Number(b.qty ?? b.quantityReceived);
      const v = (await q<any>('SELECT inventory_item_id FROM variants WHERE shop_id=$1 AND sku=$2', [shop.id, b.sku]))[0];
      if (!v || !Number.isInteger(qty) || qty <= 0) return reply.code(422).send({ error: 'unknown sku or bad quantity' });
      const key = String(b.idempotencyKey ?? req.headers['idempotency-key'] ?? '');
      const lv = await tx(async (c) => adjustLevel(c, shop, v.inventory_item_id, await shopLocation(c, shop.id), qty, 'CARPIP_RECEIPT', b.poNumber ?? null, key || null, true));
      await q(`INSERT INTO api_log(shop_id, direction, method, path, status, note) VALUES ($1,'IN','POST','/legacy/carpip/callback',200,$2)`,
        [shop.id, `stock receipt ${b.sku} +${qty}${lv.duplicate ? ' (duplicate, ignored)' : ''}`]);
      return { accepted: true, available: lv.available, duplicate: !!lv.duplicate };
    }
    return reply.code(400).send({ error: `unknown event ${b.event}` });
  });
}
