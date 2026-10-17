// In-memory stand-ins for D1 and R2, for tests in plain Node.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const read = (f: string) => readFileSync(new URL(`../../../d1/migrations/${f}`, import.meta.url), 'utf8');
export const SCHEMA = [read('0001_sessions.sql'), read('0002_names_artifacts.sql')];

/** Just enough of the D1 API, backed by an in-memory SQLite database. */
export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind: (...a: unknown[]) => ((args = a), stmt),
      all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
      first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
      run: async () => (db.prepare(sql).run(...(args as any[])), { success: true }),
    };
    return stmt;
  };
  return { prepare, exec: async (sql: string) => db.exec(sql) } as any;
}

/** An in-memory R2 bucket. */
export function fakeR2() {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    put: async (k: string, v: Uint8Array) => void store.set(k, new Uint8Array(v)),
    get: async (k: string) => (store.has(k) ? { arrayBuffer: async () => store.get(k)!.slice().buffer } : null),
    delete: async (k: string | string[]) => void [k].flat().forEach((x) => store.delete(x)),
  };
}
