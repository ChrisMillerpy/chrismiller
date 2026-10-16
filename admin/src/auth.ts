// Login for admin: one password (ADMIN_PASSWORD), remembered for about a year by a cookie,
// so the iPhone home-screen app only asks once. Open when no password is set.
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

/** null = let the request through; otherwise the response to send instead. */
export async function checkAuth(request: Request, password: string | undefined): Promise<Response | null> {
  if (!password) return null;
  const url = new URL(request.url);
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
