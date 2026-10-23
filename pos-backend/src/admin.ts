/** Provisioning (used by the bootstrap job) and demo-scenario endpoints. Protected by X-Admin-Token. */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { cfg } from './config.js';
import { q, tx } from './db.js';
import { adjustLevel, checkout, shopLocation } from './inventory.js';
import { enqueueLegacyPush } from './webhooks.js';
import { pinHash } from './internal.js';
import { hmacB64, rand, safeEq, sha256Hex } from './util.js';
import { getSetting, setSetting, type Shop } from './webhooks.js';

async function adminAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const t = String(req.headers['x-admin-token'] ?? '');
  if (!cfg.adminToken || !safeEq(t, cfg.adminToken)) return void reply.code(401).send({ code: 'UNAUTHORIZED', detail: 'admin token required' });
}

async function pickShop(handle?: string): Promise<Shop> {
  const rows = handle ? await q<Shop>('SELECT * FROM shops WHERE handle=$1', [handle]) : await q<Shop>("SELECT * FROM shops WHERE mode='SHOPIFY' ORDER BY id LIMIT 1");
  if (!rows[0]) throw Object.assign(new Error('unknown shop'), { statusCode: 404 });
  return rows[0];
}

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) {
      const x = queue.shift()!;
      await fn(x);
    }
  }));
}

export function registerAdmin(app: FastifyInstance): void {
  app.register(async (s) => {
    s.addHook('preHandler', adminAuth);

    s.post('/pos/admin/shops', async (req, reply) => {
      const b = (req.body ?? {}) as any;
      if (!b.handle || !b.name || !['SHOPIFY', 'LEGACY'].includes(b.mode)) return reply.code(400).send({ code: 'BAD_REQUEST', detail: 'handle, name, mode required' });
      const token = 'shpat_' + rand(16);
      const secret = rand(24);
      const domain = b.domain ?? `${b.handle}.${b.mode === 'SHOPIFY' ? 'myshopify' : 'legacy'}.local`;
      const out = await tx(async (c) => {
        const ex = (await q<any>('SELECT id FROM shops WHERE handle=$1', [b.handle], c))[0];
        let id: number;
        if (ex) {
          id = ex.id;
          await q('UPDATE shops SET name=$2, mode=$3, city=$4, domain=$5 WHERE id=$1', [id, b.name, b.mode, b.city ?? null, domain], c);
        } else {
          id = (await q<any>(`INSERT INTO shops(handle, name, domain, mode, access_token_hash, webhook_secret, city, allow_oversell) VALUES ($1,$2,$3,$4,$5,$6,$7,false) RETURNING id`,
            [b.handle, b.name, domain, b.mode, sha256Hex(token), secret, b.city ?? null], c))[0].id;
          await q(`INSERT INTO locations(shop_id, name) VALUES ($1,$2)`, [id, `${b.name} - Main store`], c);
        }
        await q(`INSERT INTO users(shop_id, name, pin_hash, role) SELECT $1,$2,$3,'cashier' WHERE NOT EXISTS (SELECT 1 FROM users WHERE shop_id=$1 AND name=$2)`,
          [id, b.cashier ?? 'Cashier', pinHash(b.handle, String(b.pin ?? '1234'))], c);
        return id;
      });
      const shop = (await q<any>('SELECT handle, domain, mode, webhook_secret FROM shops WHERE id=$1', [out]))[0];
      return reply.code(201).send({ ...shop, hint: 'call POST /pos/admin/shops/:handle/token to obtain an access token' });
    });

    s.post('/pos/admin/shops/:handle/token', async (req) => {
      const shop = await pickShop((req.params as any).handle);
      const token = 'shpat_' + rand(16);
      await q('UPDATE shops SET access_token_hash=$2 WHERE id=$1', [shop.id, sha256Hex(token)]);
      return { handle: shop.handle, domain: shop.domain, access_token: token, webhook_secret: shop.webhook_secret, mode: shop.mode };
    });

    s.post('/pos/admin/shops/:handle/carpip', async (req) => {
      const shop = await pickShop((req.params as any).handle);
      const b = (req.body ?? {}) as any;
      await q('UPDATE shops SET carpip_base_url=$2, carpip_tenant_public_id=$3, carpip_api_key=$4, webhook_secret=COALESCE($5, webhook_secret) WHERE id=$1',
        [shop.id, b.baseUrl ?? null, b.tenantPublicId ?? null, b.apiKey ?? null, b.webhookSecret ?? null]);
      return { linked: true };
    });

    s.post('/pos/admin/shops/:handle/catalog', async (req) => {
      const shop = await pickShop((req.params as any).handle);
      const items = ((req.body ?? {}) as any).products as any[];
      const loc = await shopLocation(undefined, shop.id);
      let created = 0;
      let updated = 0;
      await tx(async (c) => {
        for (const it of items) {
          const ex = (await q<any>('SELECT v.id, v.product_id, v.inventory_item_id FROM variants v WHERE v.shop_id=$1 AND v.sku=$2', [shop.id, it.sku], c))[0];
          if (ex) {
            await q('UPDATE products SET title=$2, product_type=$3, tags=$4, updated_at=now() WHERE id=$1', [ex.product_id, it.title, it.product_type, it.tags ?? ''], c);
            await q('UPDATE variants SET price=$2, barcode=$3, updated_at=now() WHERE id=$1', [ex.id, it.price, it.barcode ?? null], c);
            await q('UPDATE inventory_items SET cost=$2 WHERE id=$1', [ex.inventory_item_id, it.cost ?? null], c);
            updated++;
            continue;
          }
          const p = (await q<any>('INSERT INTO products(shop_id, title, product_type, tags) VALUES ($1,$2,$3,$4) RETURNING id', [shop.id, it.title, it.product_type, it.tags ?? ''], c))[0];
          const ii = (await q<any>('INSERT INTO inventory_items(shop_id, sku, cost) VALUES ($1,$2,$3) RETURNING id', [shop.id, it.sku, it.cost ?? null], c))[0];
          await q('INSERT INTO variants(product_id, shop_id, sku, barcode, price, inventory_item_id) VALUES ($1,$2,$3,$4,$5,$6)', [p.id, shop.id, it.sku, it.barcode ?? null, it.price, ii.id], c);
          await q(`INSERT INTO inventory_levels(inventory_item_id, location_id, available, updated_at) VALUES ($1,$2,$3, now() - interval '1 hour')`, [ii.id, loc, it.stock ?? 0], c);
          created++;
        }
      });
      return { created, updated };
    });

    // legacy (Path B) shops: push the full stock list to CARPIP's open REST API in batches (used once by the bootstrap job)
    s.post('/pos/admin/shops/:handle/push-inventory', async (req) => {
      const shop = await pickShop((req.params as any).handle);
      if (shop.mode !== 'LEGACY') return { skipped: true, reason: 'only LEGACY shops push over REST' };
      const rows = await q<any>(
        `SELECT v.sku, v.barcode, v.price, p.title, p.product_type, i.cost, l.available, l.updated_at FROM variants v JOIN products p ON p.id=v.product_id
         JOIN inventory_items i ON i.id=v.inventory_item_id JOIN inventory_levels l ON l.inventory_item_id=i.id WHERE v.shop_id=$1 ORDER BY v.sku`, [shop.id]);
      let batches = 0;
      await tx(async (c) => {
        for (let i = 0; i < rows.length; i += 40) {
          const chunk = rows.slice(i, i + 40);
          await enqueueLegacyPush(c, shop, '/api/v1/inventory', {
            batchId: `full-${Date.now()}-${i}`,
            items: chunk.map((x: any) => ({ item_code: x.sku, name: x.title, category: x.product_type, barcode: x.barcode, price: x.price, cost: x.cost, qty: x.available, ts: new Date(x.updated_at).toISOString() })),
          }, 'inventory');
          batches++;
        }
      });
      return { items: rows.length, batches };
    });

    s.get('/pos/admin/shops', async () => q('SELECT handle, name, domain, mode, city, carpip_tenant_public_id FROM shops ORDER BY id'));

    // ---------------------------------------------------------------- demo scenarios
    s.post('/pos/demo/sales-burst', async (req) => {
      const b = (req.body ?? {}) as any;
      const shop = await pickShop(b.shop);
      const n = Math.min(Number(b.skus ?? 12), 60);
      const fraction = Math.min(Math.max(Number(b.fraction ?? 0.7), 0.1), 0.95);
      const rows = await q<any>(
        `SELECT v.sku, l.available FROM variants v JOIN inventory_levels l ON l.inventory_item_id = v.inventory_item_id WHERE v.shop_id=$1 AND l.available >= 8 ORDER BY random() LIMIT $2`,
        [shop.id, n]);
      const jobs: { sku: string; qty: number }[] = [];
      for (const r of rows) {
        let remaining = Math.ceil(r.available * fraction);
        while (remaining > 0) {
          const qty = Math.min(4, remaining);
          jobs.push({ sku: r.sku, qty });
          remaining -= qty;
        }
      }
      let ok = 0;
      let failed = 0;
      await pool(jobs, 6, async (j) => {
        try {
          await checkout(shop, [j], 'sales-burst');
          ok++;
        } catch {
          failed++;
        }
      });
      return { shop: shop.handle, skus: rows.map((r) => r.sku), orders: ok, failed, units: jobs.reduce((a, j) => a + j.qty, 0) };
    });

    s.post('/pos/demo/webhooks/pause', async (req) => {
      const b = (req.body ?? {}) as any;
      await setSetting('webhooks_paused', String(b.paused !== false));
      await setSetting('webhooks_drop', String(b.drop === true));
      return { paused: await getSetting('webhooks_paused'), drop: await getSetting('webhooks_drop') };
    });

    s.post('/pos/demo/webhooks/replay', async (req, reply) => {
      const b = (req.body ?? {}) as any;
      const mode = String(b.mode ?? 'same');
      const topic = String(b.topic ?? 'orders/create');
      const d = (await q<any>(`SELECT * FROM webhook_deliveries WHERE kind='SHOPIFY_WEBHOOK' AND status='DELIVERED' AND topic=$1 ${b.shop ? 'AND shop_id=(SELECT id FROM shops WHERE handle=$2)' : ''} ORDER BY id DESC LIMIT 1`,
        b.shop ? [topic, b.shop] : [topic]))[0];
      if (!d) return reply.code(409).send({ code: 'NOTHING_TO_REPLAY', detail: 'no delivered webhook of that topic yet - ring up a sale first' });
      const shop = (await q<Shop>('SELECT * FROM shops WHERE id=$1', [d.shop_id]))[0];
      let body: string = d.body;
      let webhookId: string = d.webhook_id;
      let triggered = new Date();
      let signature = hmacB64(shop.webhook_secret, body);
      if (mode === 'new_id') webhookId = randomUUID();
      if (mode === 'stale') { webhookId = randomUUID(); triggered = new Date(Date.now() - 3600_000); }
      if (mode === 'tampered') {
        const j = JSON.parse(body);
        if (j.line_items?.[0]) j.line_items[0].quantity += 5;
        if (typeof j.available === 'number') j.available += 50;
        body = JSON.stringify(j); // signature stays that of the ORIGINAL body
      }
      const res = await fetch(d.address, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'X-Shopify-Topic': d.topic, 'X-Shopify-Hmac-Sha256': signature, 'X-Shopify-Shop-Domain': shop.domain,
          'X-Shopify-Webhook-Id': webhookId, 'X-Shopify-Triggered-At': triggered.toISOString(), 'X-Shopify-API-Version': '2024-01',
        },
        body,
      });
      const text = (await res.text()).slice(0, 300);
      await q(`INSERT INTO api_log(shop_id, direction, method, path, status, note) VALUES ($1,'OUT','POST',$2,$3,$4)`, [shop.id, d.address, res.status, `DEMO replay (${mode}) of ${topic}`]);
      return { mode, topic, carpipStatus: res.status, carpipResponse: text };
    });

    s.post('/pos/demo/out-of-order', async (req) => {
      const b = (req.body ?? {}) as any;
      const shop = await pickShop(b.shop);
      const row = (await q<any>(`SELECT v.sku, v.inventory_item_id FROM variants v JOIN inventory_levels l ON l.inventory_item_id=v.inventory_item_id WHERE v.shop_id=$1 AND l.available >= 3 ORDER BY random() LIMIT 1`, [shop.id]))[0];
      if (!row) return { error: 'no stocked sku' };
      const loc = await shopLocation(undefined, shop.id);
      const results = await tx(async (c) => {
        const a = await adjustLevel(c, shop, row.inventory_item_id, loc, -1, 'DEMO_OUT_OF_ORDER_1', null, null);
        const bb = await adjustLevel(c, shop, row.inventory_item_id, loc, -1, 'DEMO_OUT_OF_ORDER_2', null, null);
        const ids = (await q<any>(`SELECT id FROM webhook_deliveries WHERE shop_id=$1 AND topic='inventory_levels/update' ORDER BY id DESC LIMIT 2`, [shop.id], c)).map((r) => r.id);
        // newer update (higher id) is sent first, the OLDER one 4s later => CARPIP must ignore the stale one
        if (ids.length === 2) {
          await q(`UPDATE webhook_deliveries SET next_attempt_at = now() WHERE id=$1`, [ids[0]], c);
          await q(`UPDATE webhook_deliveries SET next_attempt_at = now() + interval '4 seconds' WHERE id=$1`, [ids[1]], c);
        }
        return { first: a.available, second: bb.available };
      });
      return { sku: row.sku, ...results, note: 'older update (available=' + results.first + ') is delivered AFTER the newer one (available=' + results.second + ')' };
    });
  });
}
