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
