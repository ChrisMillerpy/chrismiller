import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAuth, handleLogin, COOKIE } from './auth.ts';

const PW = 'correct horse';
const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request('https://admin.test' + path, { ...init, headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.headers as any) } });

async function loginCookie() {
  const body = new URLSearchParams({ password: PW, next: '/cathy' });
  const res = await handleLogin(req('/login', { method: 'POST', body }), PW);
  return res.headers.get('set-cookie')!.split(';')[0];
}

test('no password set: everything is open', async () => {
  assert.equal(await checkAuth(req('/cathy'), undefined), null);
});

test('without a cookie, pages redirect to the login page and keep where you were going', async () => {
  const res = (await checkAuth(req('/cathy/abc123'), PW))!;
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login?next=%2Fcathy%2Fabc123');
});

test('without a cookie, the API answers 401 instead of redirecting', async () => {
  const res = (await checkAuth(req('/api/cathy/sessions'), PW))!;
  assert.equal(res.status, 401);
});

test('icons and the manifest load without logging in (the home screen fetches them)', async () => {
  for (const p of ['/apple-touch-icon.png', '/icon.svg', '/icon-192.png', '/manifest.webmanifest', '/login']) {
    assert.equal(await checkAuth(req(p), PW), null, p);
  }
});

test('the right password sets a long-lived, secure cookie and goes back where you were', async () => {
  const body = new URLSearchParams({ password: PW, next: '/cathy' });
  const res = await handleLogin(req('/login', { method: 'POST', body }), PW);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/cathy');
  const cookie = res.headers.get('set-cookie')!;
  assert.match(cookie, new RegExp(`^${COOKIE}=`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  const maxAge = Number(cookie.match(/Max-Age=(\d+)/)![1]);
  assert.ok(maxAge >= 300 * 24 * 3600, `Max-Age ${maxAge} is too short`);
});

test('that cookie lets you in afterwards', async () => {
  assert.equal(await checkAuth(req('/cathy', { cookie: await loginCookie() }), PW), null);
});

test('a forged or stale cookie does not', async () => {
  const res = (await checkAuth(req('/cathy', { cookie: `${COOKIE}=nope` }), PW))!;
  assert.equal(res.status, 303);
  // Changing the password logs everyone out.
  const old = await loginCookie();
  assert.equal((await checkAuth(req('/cathy', { cookie: old }), 'new password'))!.status, 303);
});

test('a wrong password shows the login page again with an error, and no cookie', async () => {
  const body = new URLSearchParams({ password: 'wrong', next: '/' });
  const res = await handleLogin(req('/login', { method: 'POST', body }), PW);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('set-cookie'), null);
  assert.match(await res.text(), /Wrong password/);
});

test('next only ever points inside admin', async () => {
  const body = new URLSearchParams({ password: PW, next: 'https://evil.example/' });
  const res = await handleLogin(req('/login', { method: 'POST', body }), PW);
  assert.equal(res.headers.get('location'), '/');
});

// ---- Cloudflare Access (second lock) ----
const TEAM = 'withchris.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const EMAIL = 'learn@withchris.uk';
const b64u = (data: string | ArrayBuffer) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  return Buffer.from(bytes).toString('base64url');
};
const rsa = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const goodKeys = await crypto.subtle.generateKey(rsa, true, ['sign', 'verify']);
const otherKeys = await crypto.subtle.generateKey(rsa, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', goodKeys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const access = { teamDomain: TEAM, aud: AUD, jwks: async () => [jwk] };

async function jwt(claims: Record<string, unknown> = {}, { key = goodKeys.privateKey, header = {} as Record<string, unknown> } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: [AUD], iss: `https://${TEAM}`, email: EMAIL, iat: now, exp: now + 3600, ...claims };
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...header }));
  const input = `${head}.${b64u(JSON.stringify(payload))}`;
  return `${input}.${b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input)))}`;
}
const withJwt = (token?: string, path = '/cathy') => req(path, token ? { headers: { 'cf-access-jwt-assertion': token } } : {});

test('access: a valid token for learn@withchris.uk gets in', async () => {
  assert.equal(await checkAuth(withJwt(await jwt()), PW, access), null);
});

test('access: aud may be a plain string, and the email check ignores case', async () => {
  assert.equal(await checkAuth(withJwt(await jwt({ aud: AUD, email: 'Learn@WithChris.uk' })), PW, access), null);
});

test('access: no header is refused', async () => {
  assert.equal((await checkAuth(withJwt(), PW, access))!.status, 403);
});

test('access: wrong aud, wrong issuer, expired, wrong email are refused', async () => {
  const bad = [
    await jwt({ aud: ['someone-else'] }),
    await jwt({ iss: 'https://evil.cloudflareaccess.com' }),
    await jwt({ exp: Math.floor(Date.now() / 1000) - 10 }),
    await jwt({ exp: undefined }),
    await jwt({ email: 'someone@else.com' }),
    await jwt({ email: undefined }),
  ];
  for (const t of bad) assert.equal((await checkAuth(withJwt(t), PW, access))!.status, 403);
});

test('access: a bad signature is refused', async () => {
  assert.equal((await checkAuth(withJwt(await jwt({}, { key: otherKeys.privateKey })), PW, access))!.status, 403);
  const [h, p, s] = (await jwt()).split('.');
  assert.equal((await checkAuth(withJwt(`${h}.${b64u(JSON.stringify({ aud: [AUD], iss: `https://${TEAM}`, email: EMAIL, exp: 9e9 }))}.${s}`), PW, access))!.status, 403);
});

test('access: unknown key id, other algorithms and junk are refused', async () => {
  assert.equal((await checkAuth(withJwt(await jwt({}, { header: { kid: 'nope' } })), PW, access))!.status, 403);
  assert.equal((await checkAuth(withJwt(await jwt({}, { header: { alg: 'none' } })), PW, access))!.status, 403);
  for (const junk of ['junk', 'a.b.c', '..']) assert.equal((await checkAuth(withJwt(junk), PW, access))!.status, 403);
});

test('access: fails closed when the keys cannot be fetched', async () => {
  const broken = { ...access, jwks: async () => { throw new Error('down'); } };
  assert.equal((await checkAuth(withJwt(await jwt()), PW, broken))!.status, 403);
});

test('access: the cookie password does not replace the token', async () => {
  assert.equal((await checkAuth(req('/cathy', { cookie: await loginCookie() }), PW, access))!.status, 403);
});

test('access: the API gets JSON, and icons and the manifest stay public', async () => {
  const res = (await checkAuth(withJwt(undefined, '/api/cathy/sessions'), PW, access))!;
  assert.equal(res.status, 403);
  assert.match(res.headers.get('content-type')!, /json/);
  for (const p of ['/apple-touch-icon.png', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest']) {
    assert.equal(await checkAuth(req(p), PW, access), null, p);
  }
});

test('access: works with no ADMIN_PASSWORD set', async () => {
  assert.equal(await checkAuth(withJwt(await jwt()), undefined, access), null);
  assert.equal((await checkAuth(withJwt(), undefined, access))!.status, 403);
});

test('access: half-configured (only one of team and aud) refuses everything', async () => {
  assert.equal((await checkAuth(withJwt(await jwt()), PW, { teamDomain: TEAM, aud: '', jwks: access.jwks }))!.status, 403);
  assert.equal((await checkAuth(withJwt(await jwt()), PW, { teamDomain: '', aud: AUD, jwks: access.jwks }))!.status, 403);
});

test('access: when not configured, the cookie login still works', async () => {
  const off = { teamDomain: '', aud: '' };
  assert.equal((await checkAuth(req('/cathy'), PW, off))!.status, 303);
  assert.equal(await checkAuth(req('/cathy', { cookie: await loginCookie() }), PW, off), null);
  assert.equal(await checkAuth(req('/cathy'), undefined, off), null);
});

test('access: team domain may be given with https:// and a trailing slash', async () => {
  assert.equal(await checkAuth(withJwt(await jwt()), PW, { ...access, teamDomain: `https://${TEAM}/` }), null);
});
