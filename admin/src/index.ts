// Admin Worker: Chris's home screen for the tools we build.
// Deliberately simple: optional password (basic auth), no database of its own.
// Styled to match learn: same blue-and-white tokens and graph paper, navy in dark mode.
import { ICON_SVG, ICON_PNGS } from './icons.ts';
import { htmlResponse, page } from './layout.ts';
import { accessOn, checkAuth, handleLogin, loginBody, loginNext } from './auth.ts';
import { homePage } from './home.ts';
import { chatPage, explorerPage } from './cathy.ts';
import { artifactPage, artifactsPage } from './artifacts.ts';
import { chatgptPage } from './chatgpt.ts';

interface Env {
  ADMIN_PASSWORD?: string;
  /** Cloudflare Access: team domain and the app's AUD tag. Set = Access is the lock and password login is off. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Service binding to the Cathy Worker (cathy/worker). */
  CATHY?: Fetcher;
  /** Static files from packs/ (Evidence Packs). */
  PACKS?: Fetcher;
}

const MANIFEST = {
  name: 'Chris Admin',
  short_name: 'Admin',
  start_url: '/',
  display: 'standalone',
  background_color: '#FAFBFD',
  theme_color: '#FAFBFD',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Behind Cloudflare Access the password page is off; checkAuth checks the Access token instead.
    const access = { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD };
    // Otherwise: one password, remembered by a cookie for about a year.
    if (!accessOn(access)) {
      if (pathname === '/login' && request.method === 'POST' && env.ADMIN_PASSWORD) return handleLogin(request, env.ADMIN_PASSWORD, loginPage);
      if (pathname === '/login') return htmlResponse(loginPage(loginBody(loginNext(request))));
    }
    const denied = await checkAuth(request, env.ADMIN_PASSWORD, access);
    if (denied) return denied;

    // Cathy's API lives in the Cathy Worker; forward it (WebSockets included).
    if (pathname.startsWith('/api/cathy/')) {
      if (!env.CATHY) return Response.json({ error: 'Cathy is not connected to this admin.' }, { status: 503 });
      const target = new URL(pathname.replace('/api/cathy/', '/api/') + url.search, 'https://cathy.internal');
      return env.CATHY.fetch(new Request(target, request));
    }

    // Evidence Packs: static pages from packs/, at /packs/<name>/.
    if (pathname === '/packs') return Response.redirect(new URL('/packs/', url).toString(), 302);
    if (pathname.startsWith('/packs/') && env.PACKS) {
      const target = new URL(pathname.slice('/packs'.length) + url.search, url);
      return env.PACKS.fetch(new Request(target, request));
    }

    if (pathname === '/') return htmlResponse(homePage());
    if (pathname === '/chatgpt' || pathname === '/chatgpt/') return htmlResponse(chatgptPage());
    if (pathname === '/cathy' || pathname === '/cathy/') return htmlResponse(explorerPage());
    if (/^\/cathy\/[a-z0-9]+$/.test(pathname)) return htmlResponse(chatPage());
  if (pathname === '/artifacts' || pathname === '/artifacts/') return htmlResponse(artifactsPage());
  if (/^\/artifacts\/[a-z0-9]+$/.test(pathname)) return htmlResponse(artifactPage());

    if (pathname === '/manifest.webmanifest') {
      return new Response(JSON.stringify(MANIFEST), { headers: { 'content-type': 'application/manifest+json' } });
    }
    if (pathname === '/icon.svg') {
      return new Response(ICON_SVG, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
    }
    if (pathname in ICON_PNGS) {
      const bytes = Uint8Array.from(atob(ICON_PNGS[pathname as keyof typeof ICON_PNGS]), (c) => c.charCodeAt(0));
      return new Response(bytes, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

const LOGIN_CSS = `
  .login { max-width:360px; margin:8vh auto 0; }
  .login form { display:grid; gap:10px; }
  .login label { font-weight:600; font-size:14px; color:var(--muted); }
  .login input[type=password] { font:inherit; padding:12px 14px; border-radius:12px; border:1px solid var(--line); background:var(--bg); color:var(--ink); }
  .login input:focus { outline:2px solid var(--cobalt); outline-offset:1px; }
  .login button { font:inherit; font-weight:600; border:0; border-radius:12px; padding:12px; background:var(--fill); color:#fff; cursor:pointer; box-shadow:0 2px 0 var(--fill-shadow); }
  .login .error { color:var(--pen); margin:0; font-size:14px; }
`;
const loginPage = (body: string) => page({ title: 'Log in · Admin', css: LOGIN_CSS, body });
