import pg from 'pg';
import { cfg } from './config.js';

export const pool = new pg.Pool({ connectionString: cfg.dbUrl, max: 8 });
// timestamptz(3) values are read as JS Dates (ms precision)
pg.types.setTypeParser(20, (v) => Number(v)); // int8 -> number (ids fit in 2^53)
pg.types.setTypeParser(1700, (v) => v); // numeric stays a string (exact money)
pg.types.setTypeParser(1082, (v) => v); // date stays 'YYYY-MM-DD' (no timezone shift)

export async function q<T = any>(text: string, params: any[] = [], client?: pg.PoolClient): Promise<T[]> {
  const r = await (client ?? pool).query(text, params);
  return r.rows as T[];
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function waitForDb(tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('database not reachable');
}
