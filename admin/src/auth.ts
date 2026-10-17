// Two ways in:
// 1. Cloudflare Access (production). When ACCESS_TEAM_DOMAIN and ACCESS_AUD are set, every request
//    must carry a valid Cf-Access-Jwt-Assertion for ACCESS_EMAIL. Anything else is refused.
// 2. Password (previews, local dev). One password (ADMIN_PASSWORD), remembered for about a year
//    by a cookie, so the iPhone home-screen app only asks once. Open when no password is set.
export const COOKIE = 'admin';
const MAX_AGE = 400 * 24 * 3600; // the longest browsers allow

// Paths that must work before logging in.
const PUBLIC = new Set(['/login', '/manifest.webmanifest', '/icon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png']);

/** The cookie value: an HMAC of a fixed label, keyed by the password. Changing the password logs everyone out. */
async function token(password: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('withchris-admin-v1'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const cookieValue = (request: Request) =>
  request.headers.get('cookie')?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);

const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');

export const ACCESS_EMAIL = 'learn@withchris.uk';
type Jwk = JsonWebKey & { kid?: string };

export interface AccessConfig {
  teamDomain?: string;
  aud?: string;
  /** Where the public keys come from. Tests pass their own; the default asks Cloudflare. */
  jwks?: (teamHost: string) => Promise<Jwk[]>;
}

const teamHost = (domain: string) => domain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');

let keyCache: { host: string; keys: Jwk[]; at: number } | undefined;
async function fetchJwks(host: string): Promise<Jwk[]> {
  if (keyCache && keyCache.host === host && Date.now() - keyCache.at < 10 * 60_000) return keyCache.keys;
  const res = await fetch(`https://${host}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs HTTP ${res.status}`);
  const keys = ((await res.json()) as { keys: Jwk[] }).keys;
  keyCache = { host, keys, at: Date.now() };
  return keys;
}

const b64uBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64uJson = (s: string) => JSON.parse(new TextDecoder().decode(b64uBytes(s)));

/** True only for a token signed by the team's key, for this app, from this team, not expired, for ACCESS_EMAIL. */
async function accessTokenOk(request: Request, host: string, aud: string, getKeys: NonNullable<AccessConfig['jwks']>) {
  try {
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) return false;
    const [h, p, s, extra] = token.split('.');
    if (!h || !p || !s || extra !== undefined) return false;
    const header = b64uJson(h);
    if (header.alg !== 'RS256') return false;
    const jwk = (await getKeys(host)).find((k) => k.kid === header.kid && k.kty === 'RSA');
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uBytes(s), new TextEncoder().encode(`${h}.${p}`)))) return false;
    const c = b64uJson(p);
    const now = Date.now() / 1000;
    if (typeof c.exp !== 'number' || c.exp <= now) return false;
    if (typeof c.nbf === 'number' && c.nbf > now) return false;
    if (c.iss !== `https://${host}`) return false;
    if (!(Array.isArray(c.aud) ? c.aud : [c.aud]).includes(aud)) return false;
    return typeof c.email === 'string' && c.email.toLowerCase() === ACCESS_EMAIL;
  } catch {
    return false; // fail closed
  }
}

const refuse = (url: URL) =>
  url.pathname.startsWith('/api/')
    ? Response.json({ error: 'Forbidden' }, { status: 403 })
    : new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/** True when Access is switched on (either setting present). */
export const accessOn = (a?: AccessConfig) => Boolean(a?.teamDomain || a?.aud);

/** null = let the request through; otherwise the response to send instead. */
export async function checkAuth(request: Request, password: string | undefined, access?: AccessConfig): Promise<Response | null> {
  const url = new URL(request.url);
  if (accessOn(access)) {
    if (PUBLIC.has(url.pathname) && url.pathname !== '/login') return null;
    // Only one of the two settings present is a mistake: refuse rather than guess.
    if (!access!.teamDomain || !access!.aud) return refuse(url);
    const ok = await accessTokenOk(request, teamHost(access!.teamDomain), access!.aud, access!.jwks ?? fetchJwks);
    return ok ? null : refuse(url);
  }
  if (!password) return null;
  if (PUBLIC.has(url.pathname)) return null;
  if (cookieValue(request) === (await token(password))) return null;
  if (url.pathname.startsWith('/api/')) return Response.json({ error: 'Log in first' }, { status: 401 });
  const next = encodeURIComponent(url.pathname + url.search);
  return new Response(null, { status: 303, headers: { location: `/login?next=${next}` } });
}

export function loginBody(next: string, error = '') {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<main class="login">
  <p class="eyebrow">Admin</p>
  <h1>Hi Chris</h1>
  <form method="post" action="/login">
    <input type="hidden" name="next" value="${esc(next)}">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
    <button type="submit">Log in</button>
  </form>
</main>`;
}

/** POST /login. `wrap` turns the form into a full page (admin's layout). */
export async function handleLogin(request: Request, password: string, wrap: (body: string) => string = (b) => b): Promise<Response> {
  const form = await request.formData();
  const next = safeNext(String(form.get('next') ?? '/'));
  if (String(form.get('password') ?? '') !== password) {
    return new Response(wrap(loginBody(next, 'Wrong password. Try again.')), { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const cookie = `${COOKIE}=${await token(password)}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  return new Response(null, { status: 303, headers: { location: next, 'set-cookie': cookie } });
}

/** GET /login */
export const loginNext = (request: Request) => safeNext(new URL(request.url).searchParams.get('next'));
