import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');
export const hmacB64 = (secret: string, body: string | Buffer) => createHmac('sha256', secret).update(body).digest('base64');
export const hmacHex = (secret: string, body: string | Buffer) => createHmac('sha256', secret).update(body).digest('hex');
export const rand = (n = 24) => randomBytes(n).toString('hex');

export function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** CARPIP signature scheme: v1=hex(HMAC_SHA256(secret, ts + "." + eventId + "." + rawBody)) */
export function carpipSign(secret: string, ts: string, eventId: string, body: string | Buffer): string {
  const b = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return 'v1=' + hmacHex(secret, Buffer.concat([Buffer.from(`${ts}.${eventId}.`), b]));
}

export function carpipVerify(secret: string, header: string | undefined, ts: string | undefined, eventId: string | undefined, body: Buffer, toleranceS = 300): boolean {
  if (!header || !ts || !eventId) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceS) return false;
  const expected = carpipSign(secret, ts, eventId, body);
  return header.split(',').some((p) => safeEq(p.trim(), expected));
}

export const toCents = (v: string | number): number => Math.round(Number(v) * 100);
export const fromCents = (c: number): string => (c / 100).toFixed(2);

/** Signed, expiring UI token: base64url(payload).hmac */
export function signToken(secret: string, payload: Record<string, unknown>, ttlS = 8 * 3600): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlS })).toString('base64url');
  return `${body}.${hmacHex(secret, body)}`;
}

export function verifyToken(secret: string, token: string | undefined): Record<string, any> | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig || !safeEq(sig, hmacHex(secret, body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch {
    return null;
  }
}
