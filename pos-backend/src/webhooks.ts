import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { q } from './db.js';
import { hmacB64 } from './util.js';

const BACKOFF_S = [1, 5, 30, 120, 600, 600, 600, 600];
const MAX_ATTEMPTS = BACKOFF_S.length;

export interface Shop {
  id: number;
  handle: string;
  name: string;
  domain: string;
  mode: 'SHOPIFY' | 'LEGACY';
  webhook_secret: string;
  carpip_base_url: string | null;
  carpip_tenant_public_id: string | null;
  carpip_api_key: string | null;
  allow_oversell: boolean;
}

export async function getSetting(key: string, client?: pg.PoolClient): Promise<string> {
  const r = await q<{ value: string }>('SELECT value FROM settings WHERE key = $1', [key], client);
  return r[0]?.value ?? '';
}

export async function setSetting(key: string, value: string): Promise<void> {
  await q('INSERT INTO settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
}

/**
 * Enqueue a Shopify-style webhook for every matching subscription of the shop.
 * Called inside the business transaction (transactional outbox), so a sale and its webhook commit together.
 */
export async function enqueueWebhook(client: pg.PoolClient, shop: Shop, topic: string, payload: unknown, triggeredAt = new Date()): Promise<void> {
  if ((await getSetting('webhooks_paused', client)) === 'true' && (await getSetting('webhooks_drop', client)) === 'true') {
    return; // demo: simulate lost webhooks (CARPIP must recover through polling)
  }
  const subs = await q<{ address: string }>('SELECT address FROM webhook_subscriptions WHERE shop_id = $1 AND topic = $2', [shop.id, topic], client);
  const body = JSON.stringify(payload);
  for (const s of subs) {
    await q(
      `INSERT INTO webhook_deliveries(shop_id, kind, webhook_id, topic, address, body, triggered_at)
       VALUES ($1,'SHOPIFY_WEBHOOK',$2,$3,$4,$5,$6)`,
      [shop.id, randomUUID(), topic, s.address, body, triggeredAt],
      client,
    );
  }
}

/** Legacy shops push to CARPIP's open REST API (Path B) with a non-canonical payload, an API key and an Idempotency-Key. */
export async function enqueueLegacyPush(client: pg.PoolClient, shop: Shop, path: string, payload: unknown, topic: string): Promise<void> {
  if (!shop.carpip_base_url || !shop.carpip_api_key) return;
  const id = randomUUID();
  await q(
    `INSERT INTO webhook_deliveries(shop_id, kind, webhook_id, topic, address, body, headers)
     VALUES ($1,'LEGACY_PUSH',$2,$3,$4,$5,$6)`,
    [shop.id, id, topic, shop.carpip_base_url.replace(/\/+$/, '') + path, JSON.stringify(payload),
      JSON.stringify({ Authorization: `Bearer ${shop.carpip_api_key}`, 'Idempotency-Key': id })],
    client,
  );
}

async function deliverOne(row: any): Promise<void> {
  const shops = await q<Shop>('SELECT * FROM shops WHERE id = $1', [row.shop_id]);
  const shop = shops[0];
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(row.headers ?? {}) };
  if (row.kind === 'SHOPIFY_WEBHOOK') {
    headers['X-Shopify-Topic'] = row.topic;
    headers['X-Shopify-Hmac-Sha256'] = hmacB64(shop.webhook_secret, row.body);
    headers['X-Shopify-Shop-Domain'] = shop.domain;
    headers['X-Shopify-Webhook-Id'] = row.webhook_id;
    headers['X-Shopify-Triggered-At'] = new Date(row.triggered_at).toISOString();
    headers['X-Shopify-API-Version'] = '2024-01';
  }
  let code = 0;
  let err: string | null = null;
  try {
    const res = await fetch(row.address, { method: 'POST', headers, body: row.body, signal: AbortSignal.timeout(8000) });
    code = res.status;
    if (!res.ok) err = (await res.text()).slice(0, 200);
  } catch (e: any) {
    err = String(e?.cause?.code ?? e?.message ?? e).slice(0, 200);
  }
  const attempts = row.attempts + 1;
  if (code >= 200 && code < 300) {
    await q(`UPDATE webhook_deliveries SET status='DELIVERED', attempts=$2, last_status_code=$3, last_error=NULL, delivered_at=now() WHERE id=$1`, [row.id, attempts, code]);
    await q(`INSERT INTO api_log(shop_id, direction, method, path, status, note) VALUES ($1,'OUT','POST',$2,$3,$4)`, [row.shop_id, row.address, code, row.topic]);
  } else if (code >= 400 && code < 500 && code !== 408 && code !== 429) {
    // permanent client error (bad signature, unknown tenant...): do not hammer the receiver
    await q(`UPDATE webhook_deliveries SET status='FAILED', attempts=$2, last_status_code=$3, last_error=$4 WHERE id=$1`, [row.id, attempts, code, err]);
    await q(`INSERT INTO api_log(shop_id, direction, method, path, status, note) VALUES ($1,'OUT','POST',$2,$3,$4)`, [row.shop_id, row.address, code, `${row.topic} rejected: ${err}`]);
  } else if (attempts >= MAX_ATTEMPTS) {
    await q(`UPDATE webhook_deliveries SET status='FAILED', attempts=$2, last_status_code=$3, last_error=$4 WHERE id=$1`, [row.id, attempts, code || null, err]);
  } else {
    await q(
      `UPDATE webhook_deliveries SET attempts=$2, last_status_code=$3, last_error=$4, next_attempt_at = now() + make_interval(secs => $5) WHERE id=$1`,
      [row.id, attempts, code || null, err, BACKOFF_S[attempts - 1]],
    );
  }
}

let running = false;

export function startWorker(): void {
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      if ((await getSetting('webhooks_paused')) === 'true') return;
      const due = await q(`SELECT * FROM webhook_deliveries WHERE status='PENDING' AND next_attempt_at <= now() ORDER BY id LIMIT 20`);
      // deliver in id order per shop so CARPIP sees events in causal order (it still tolerates reordering)
      await Promise.all(due.map((r) => deliverOne(r)));
    } catch (e) {
      console.error('webhook worker error', e);
    } finally {
      running = false;
    }
  }, 700);
}
