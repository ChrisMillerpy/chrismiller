// Signing in with a ChatGPT plan, the way OpenAI's Codex CLI does: OAuth with PKCE. Pure
// functions over fetch and the Web Crypto API, so they test under plain Node. The CLIENT_ID
// is Codex CLI's own public client; there is no client secret. Nothing here logs or returns
// a token in an error message.
export const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
export const TOKEN_URL = 'https://auth.openai.com/oauth/token';
/** Codex CLI's redirect. Nothing listens there for us: Chris copies the address back (see the admin page). */
export const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPE = 'openid profile email offline_access';
const AUTH_CLAIM = 'https://api.openai.com/auth';

export interface Tokens {
  access: string;
  refresh: string;
  /** Milliseconds since the epoch. */
  expires: number;
  /** Only used to show who is connected. */
  idToken?: string;
}

/** A refresh that failed. `permanent` means the refresh token is dead and Chris must sign in again. */
export class AuthError extends Error {
  permanent: boolean;
  constructor(message: string, permanent = false) {
    super(message);
    this.permanent = permanent;
  }
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** Start a sign-in: a secret verifier (kept by us), a state (checked on return) and the address Chris opens. */
export async function newLogin() {
  const verifier = random(48);
  const state = random(24);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const url = new URL(AUTHORIZE_URL);
  for (const [k, v] of Object.entries({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs',
  })) url.searchParams.set(k, v);
  return { verifier, state, url: url.toString() };
}

/** What Chris pasted back: the whole address, `code#state`, `code=…&state=…`, or a bare code. */
export function parsePasted(input: string): { code?: string; state?: string; error?: string } {
  const v = (input || '').trim();
  if (!v) return {};
  const fromParams = (p: URLSearchParams) => {
    if (p.get('error')) return { error: p.get('error')! };
    return { code: p.get('code') ?? undefined, state: p.get('state') ?? undefined };
  };
  try {
    return fromParams(new URL(v).searchParams);
  } catch {}
  if (v.includes('code=') || v.includes('error=')) return fromParams(new URLSearchParams(v.replace(/^\?/, '')));
  if (v.includes('#')) {
    const [code, state] = v.split('#', 2);
    return { code, state };
  }
  return { code: v };
}

type Fetch = typeof globalThis.fetch;

async function tokenRequest(params: Record<string, string>, fetchImpl: Fetch, what: string) {
  const res = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, client_id: CLIENT_ID }) });
  if (!res.ok) {
    // Say what happened, never what was sent or received: the body can echo secrets.
    const permanent = res.status === 400 && /invalid_grant/.test(await res.text().catch(() => ''));
    throw new AuthError(`ChatGPT ${what} failed (${res.status})`, permanent);
  }
  return (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number };
}

/** Swap the code from the sign-in for tokens. */
export async function exchangeCode(code: string, verifier: string, fetchImpl: Fetch = fetch, now = Date.now): Promise<Tokens> {
  const j = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT_URI }, fetchImpl, 'sign-in');
  if (!j.access_token || !j.refresh_token || typeof j.expires_in !== 'number') throw new AuthError('ChatGPT sign-in returned an incomplete answer');
  const tokens = { access: j.access_token, refresh: j.refresh_token, expires: now() + j.expires_in * 1000, idToken: j.id_token };
  if (!claims(tokens.access)[AUTH_CLAIM]?.chatgpt_account_id) throw new AuthError('ChatGPT sign-in did not say which account this is');
  return tokens;
}

/** A fresh access token. ChatGPT may rotate the refresh token; if it doesn't, the old one stays valid. */
export async function refreshTokens(refresh: string, fetchImpl: Fetch = fetch, now = Date.now): Promise<Tokens> {
  const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh }, fetchImpl, 'token refresh');
  if (!j.access_token || typeof j.expires_in !== 'number') throw new AuthError('ChatGPT token refresh returned an incomplete answer');
  return { access: j.access_token, refresh: j.refresh_token || refresh, expires: now() + j.expires_in * 1000, idToken: j.id_token };
}

function claims(jwt: string | undefined): Record<string, any> {
  try {
    const part = (jwt ?? '').split('.')[1];
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

/** Who these tokens belong to. The account id is sent with every request; email and plan are only for display. */
export function accountFrom(t: Pick<Tokens, 'access' | 'idToken'>) {
  const auth = claims(t.access)[AUTH_CLAIM] ?? {};
  const id = claims(t.idToken);
  return { accountId: String(auth.chatgpt_account_id ?? ''), email: id.email as string | undefined, plan: (id[AUTH_CLAIM]?.chatgpt_plan_type ?? auth.chatgpt_plan_type) as string | undefined };
}
