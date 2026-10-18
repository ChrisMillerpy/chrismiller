// The ChatGPT sign-in: stores the tokens, keeps them fresh and hands out access tokens.
// Written over a tiny key-value interface (a Durable Object's storage in production, a Map
// in tests). The only things that ever leave are a short-lived access token (to the code
// that makes the request) and a status with the email and plan. Refresh tokens, the PKCE
// verifier and the id token never leave.
import { singleFlight } from '../../sandbox/single-flight.ts';
import { AuthError, accountFrom, exchangeCode, newLogin, parsePasted, refreshTokens, type Tokens } from './chatgpt-oauth.ts';

export interface KV {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
}

const PENDING_MS = 10 * 60_000;
/** Refresh this long before expiry, so a request never starts with a token about to die. */
const SKEW_MS = 2 * 60_000;
const CONNECT_HINT = 'Open Admin, then Cathy, then ChatGPT plan, and connect it.';

type Stored = Tokens & { accountId: string; email?: string; plan?: string };
type Pending = { verifier: string; state: string; expires: number };

const same = (a: string, b: string) => a.length === b.length && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

export class Vault {
  private kv: KV;
  private fetchImpl: typeof globalThis.fetch;
  private now: () => number;
  constructor(kv: KV, fetchImpl: typeof globalThis.fetch = fetch, now: () => number = Date.now) {
    this.kv = kv;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  async status(): Promise<{ connected: boolean; email?: string; plan?: string }> {
    const t = await this.kv.get<Stored>('tokens');
    return t ? { connected: true, ...(t.email ? { email: t.email } : {}), ...(t.plan ? { plan: t.plan } : {}) } : { connected: false };
  }

  /** Begin signing in. Replaces any sign-in that was half done. Returns only the address to open. */
  async start() {
    const { verifier, state, url } = await newLogin();
    await this.kv.put('pending', { verifier, state, expires: this.now() + PENDING_MS } satisfies Pending);
    return { url };
  }

  /** Finish with what Chris pasted back. One attempt per start: any outcome uses up the pending sign-in. */
  async finish(pasted: string) {
    const pending = await this.kv.get<Pending>('pending');
    const { code, state, error } = parsePasted(pasted);
    if (error) throw new Error(`ChatGPT said: ${error}`);
    if (!code) throw new Error('Paste the address the ChatGPT page ended on (it will look like http://localhost:1455/auth/callback?code=…).');
    if (!state) throw new Error('That is missing the state part, so I can\'t check it is yours. Paste the whole address.');
    if (!pending || pending.expires < this.now()) {
      await this.kv.delete('pending');
      throw new Error('That sign-in expired or was already used. Start again.');
    }
    await this.kv.delete('pending');
    if (!same(state, pending.state)) throw new Error("That address doesn't match the sign-in I started. Start again.");
    const tokens = await exchangeCode(code, pending.verifier, this.fetchImpl, this.now);
    await this.kv.put('tokens', { ...tokens, ...accountFrom(tokens) } satisfies Stored);
    return this.status();
  }

  /** A usable access token and the account id to send with it. `force` refreshes even if it looks fresh. */
  async accessToken(force = false): Promise<{ access: string; accountId: string }> {
    let t = await this.kv.get<Stored>('tokens');
    if (!t) throw new Error(`ChatGPT isn't connected. ${CONNECT_HINT}`);
    if (force || t.expires - this.now() < SKEW_MS) t = await this.refresh();
    return { access: t.access, accountId: t.accountId };
  }

  /** One refresh at a time: ChatGPT rotates the refresh token, so two at once would kill the sign-in. */
  private refresh = singleFlight(async (): Promise<Stored> => {
    const old = await this.kv.get<Stored>('tokens');
    if (!old) throw new Error(`ChatGPT isn't connected. ${CONNECT_HINT}`);
    try {
      const fresh = await refreshTokens(old.refresh, this.fetchImpl, this.now);
      const next: Stored = { ...old, ...fresh, idToken: fresh.idToken ?? old.idToken, accountId: accountFrom(fresh).accountId || old.accountId };
      await this.kv.put('tokens', next); // saved before anyone uses it
      return next;
    } catch (e) {
      if (e instanceof AuthError && e.permanent) {
        await this.kv.delete('tokens');
        throw new Error(`The ChatGPT sign-in expired. ${CONNECT_HINT}`);
      }
      throw e;
    }
  });

  async disconnect() {
    await this.kv.delete('tokens');
    await this.kv.delete('pending');
  }
}
