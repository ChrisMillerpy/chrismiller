// Money: Chris's Monzo spending, posted into a "Money" chat as it happens.
// Monzo calls a webhook on every transaction; the public money Worker (money/) checks the
// secret URL and forwards the body here. We keep a short record in D1, work out the week's
// spending so far, and post one line to the Money chat, where Cathy replies.
// No Cloudflare code, so it's tested in plain Node.
import type { Registry } from './registry.ts';

export type Kind = 'spend' | 'refund' | 'income' | 'declined' | 'pot';

/** A transaction, cut down to what we show and total. */
export interface Txn {
  id: string;
  /** Pence. Negative = money out. */
  amount: number;
  currency: string;
  /** ms since epoch. */
  created: number;
  merchant: string;
  category: string;
  kind: Kind;
  decline_reason: string | null;
}

/** Text from the bank goes into Cathy's context: one line, no brackets (they mark messages from Chris and Cathys), short. */
const clean = (s: unknown, n = 60) => {
  const t = String(s ?? '').replace(/[\x00-\x1f\x7f[\]{}<>`]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Reads Monzo's transaction.created webhook body. Null if it isn't a well-formed transaction. */
export function parseMonzo(body: unknown): Txn | null {
  const b = body as any;
  if (!b || typeof b !== 'object' || b.type !== 'transaction.created' || !b.data || typeof b.data !== 'object') return null;
  const d = b.data;
  if (typeof d.id !== 'string' || !/^[\w-]{1,80}$/.test(d.id)) return null;
  if (!Number.isInteger(d.amount) || Math.abs(d.amount) > 1e9) return null;
  if (typeof d.currency !== 'string') return null;
  const created = typeof d.created === 'string' ? Date.parse(d.created) : NaN;
  if (!Number.isFinite(created)) return null;

  const description = clean(d.description);
  const merchant = clean(d.merchant && typeof d.merchant === 'object' && d.merchant.name ? d.merchant.name : description) || 'Unknown';
  const isPot = Boolean(d.metadata?.pot_id) || /^pot_/.test(description) || d.scheme === 'uk_retail_pot';
  const declined = typeof d.decline_reason === 'string' && d.decline_reason ? clean(d.decline_reason, 40) : null;
  const hasMerchant = Boolean(d.merchant);
  const kind: Kind = isPot ? 'pot' : declined ? 'declined' : d.amount < 0 ? 'spend' : hasMerchant && !d.is_load ? 'refund' : 'income';
  return {
    id: d.id,
    amount: d.amount,
    currency: clean(d.currency, 3).toUpperCase(),
    created,
    merchant,
    category: clean(d.category || 'general', 30),
    kind,
    decline_reason: declined,
  };
}

/** The Monday a week starts on, in London time, as YYYY-MM-DD. */
export function weekOf(ms: number): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export const pounds = (pence: number) => `£${(Math.abs(pence) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (t: Txn) => (t.currency === 'GBP' ? pounds(t.amount) : `${(Math.abs(t.amount) / 100).toFixed(2)} ${t.currency}`);
const words = (s: string) => s.replace(/_/g, ' ').toLowerCase();

export interface Week {
  /** Net spending in pence (purchases minus shop refunds). */
  spent: number;
  /** Purchases. */
  count: number;
}

/** What's posted to the Money chat: the transaction, then the week so far. */
export function describe(t: Txn, week: Week): string {
  const line =
    t.kind === 'spend' ? `Spent ${money(t)} at ${t.merchant} (${words(t.category)})`
    : t.kind === 'declined' ? `Declined: ${money(t)} at ${t.merchant} (${words(t.decline_reason ?? 'declined')})`
    : t.kind === 'refund' ? `Refund: ${money(t)} from ${t.merchant}`
    : t.kind === 'pot' ? `Moved ${money(t)} ${t.amount < 0 ? 'into' : 'out of'} a pot`
    : `Money in: ${money(t)} from ${t.merchant}`;
  return `${line}\nThis week so far: ${pounds(week.spent)} across ${week.count} purchase${week.count === 1 ? '' : 's'}`;
}

interface D1Like {
  prepare(sql: string): { bind(...args: unknown[]): any; all(): Promise<{ results: any[] }> };
  exec(sql: string): Promise<unknown>;
}

export class Money {
  private db: D1Like;
  private registry: Registry;
  constructor(db: D1Like, registry: Registry) {
    this.db = db;
    this.registry = registry;
  }
  // The registry applies every migration (including 0004_money.sql) on first use.
  private init() {
    return this.registry.list().then(() => undefined);
  }

  /** Stores a transaction. False if it was already stored (a webhook retry). */
  async record(t: Txn, now = Date.now()): Promise<boolean> {
    await this.init();
    const { results } = await this.db
      .prepare('INSERT OR IGNORE INTO money_transactions (id, amount, currency, created_at, week, merchant, category, kind, decline_reason, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .bind(t.id, t.amount, t.currency, t.created, weekOf(t.created), t.merchant, t.category, t.kind, t.decline_reason, now)
      .all();
    return results.length > 0;
  }

  /** Spending in a week (GBP only): purchases minus refunds from shops. */
  async week(week: string): Promise<Week> {
    await this.init();
    const { results } = await this.db
      .prepare("SELECT COALESCE(-SUM(amount), 0) AS spent, COALESCE(SUM(kind = 'spend'), 0) AS count FROM money_transactions WHERE week = ? AND currency = 'GBP' AND kind IN ('spend', 'refund')")
      .bind(week)
      .all();
    return { spent: Number(results[0]?.spent ?? 0), count: Number(results[0]?.count ?? 0) };
  }

  /** The Money chat's id. Made on first use, and again if Chris archived it. */
  async chat(): Promise<string> {
    await this.init();
    const { results } = await this.db.prepare("SELECT value FROM money_settings WHERE key = 'chat'").all();
    const existing = results[0]?.value && (await this.registry.get(results[0].value));
    if (existing && existing.status === 'active') return existing.id;
    const s = await this.registry.create('Money');
    await this.db.prepare("INSERT INTO money_settings (key, value) VALUES ('chat', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(s.id).run();
    return s.id;
  }
}

export interface ReceiveDeps {
  money: Money;
  /** Post text to a chat; `reply` = ask Cathy to answer it. */
  post(chat: string, text: string, reply: boolean): Promise<void>;
}

/**
 * A webhook body from Monzo. Purchases and declines go to the Money chat for Cathy to answer;
 * money in and refunds are shown without a reply; pot moves are only stored.
 */
export async function receive(body: unknown, d: ReceiveDeps): Promise<{ ok: boolean; posted: boolean }> {
  if ((body as any)?.type !== 'transaction.created') return { ok: true, posted: false };
  const t = parseMonzo(body);
  if (!t) return { ok: false, posted: false };
  if (!(await d.money.record(t))) return { ok: true, posted: false };
  if (t.kind === 'pot') return { ok: true, posted: false };
  const text = describe(t, await d.money.week(weekOf(t.created)));
  await d.post(await d.money.chat(), text, t.kind === 'spend' || t.kind === 'declined');
  return { ok: true, posted: true };
}
