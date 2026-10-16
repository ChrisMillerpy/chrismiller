// Admin Worker: Chris's home screen for the tools we build.
// Deliberately simple: optional password (basic auth), no database of its own.
// Styled to match learn: same blue-and-white tokens and graph paper, navy in dark mode.
import { ICON_SVG, ICON_PNGS } from './icons.ts';
import { htmlResponse } from './layout.ts';
import { homePage } from './home.ts';
import { chatPage, explorerPage } from './cathy.ts';

interface Env {
  ADMIN_PASSWORD?: string;
  /** Service binding to the Cathy Worker (cathy/worker). */
  CATHY?: Fetcher;
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
    if (!authorised(request, env)) {
      return new Response('Password needed', {
        status: 401,
        headers: { 'www-authenticate': 'Basic realm="Admin", charset="UTF-8"' },
      });
    }

    const url = new URL(request.url);
    const { pathname } = url;

    // Cathy's API lives in the Cathy Worker; forward it (WebSockets included).
    if (pathname.startsWith('/api/cathy/')) {
      if (!env.CATHY) return Response.json({ error: 'Cathy is not connected to this admin.' }, { status: 503 });
      const target = new URL(pathname.replace('/api/cathy/', '/api/') + url.search, 'https://cathy.internal');
      return env.CATHY.fetch(new Request(target, request));
    }

    if (pathname === '/') return htmlResponse(homePage());
    if (pathname === '/cathy' || pathname === '/cathy/') return htmlResponse(explorerPage());
    if (/^\/cathy\/[a-z0-9]+$/.test(pathname)) return htmlResponse(chatPage());

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

// Any username; the password must match ADMIN_PASSWORD. Open if it isn't set.
function authorised(request: Request, env: Env) {
  if (!env.ADMIN_PASSWORD) return true;
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = atob(header.slice(6));
    return decoded.slice(decoded.indexOf(':') + 1) === env.ADMIN_PASSWORD;
  } catch {
    return false;
  }
}
