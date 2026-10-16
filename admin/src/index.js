// Admin Worker: Chris's home screen for the tools we build.
// Deliberately simple: optional password (basic auth), no database.
// Styled to match learn: same blue-and-white tokens and graph paper, navy in dark mode.

import { ICON_SVG, ICON_PNGS } from './icons.js';

export default {
  async fetch(request, env) {
    if (!authorised(request, env)) {
      return new Response('Password needed', {
        status: 401,
        headers: { 'www-authenticate': 'Basic realm="Admin", charset="UTF-8"' },
      });
    }

    const { pathname } = new URL(request.url);
    if (pathname === '/manifest.webmanifest') {
      return new Response(JSON.stringify(MANIFEST), { headers: { 'content-type': 'application/manifest+json' } });
    }
    if (pathname === '/icon.svg') {
      return new Response(ICON_SVG, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
    }
    if (ICON_PNGS[pathname]) {
      const bytes = Uint8Array.from(atob(ICON_PNGS[pathname]), (c) => c.charCodeAt(0));
      return new Response(bytes, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
    }
    return new Response(PAGE, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' },
    });
  },
};

// Any username; the password must match ADMIN_PASSWORD. Open if it isn't set.
function authorised(request, env) {
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

// One card per feature. Add new features here.
const CARDS = [
  { id: 'cathy', title: 'Cathy', sub: 'Sessions with your tutor agent', icon: 'chat' },
  { id: 'codebase', title: 'Codebase', sub: 'chrismiller on GitHub', icon: 'code', href: 'https://github.com/ChrisMillerpy/chrismiller' },
];

const ICONS = {
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
};

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

// Cards with an href are links (opened in a new tab); the rest are no-op buttons for now.
const cardHtml = (c) => `
  ${c.href ? `<a class="card" href="${c.href}" target="_blank" rel="noopener" data-id="${c.id}">` : `<button class="card" type="button" data-id="${c.id}">`}
    <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[c.icon]}</svg></span>
    <span class="txt"><span class="t">${c.title}</span><span class="s">${c.sub}</span></span>
  ${c.href ? '</a>' : '</button>'}`;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Admin">
<meta name="theme-color" content="#FAFBFD" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0B1222" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,500..600&family=Public+Sans:wght@400..600&display=swap">
<title>Admin</title>
<style>
  /* Same tokens as the learn site (src/styles/global.css). */
  :root {
    --paper:#FAFBFD; --bg:#FFFFFF; --ink:#18203A; --muted:#5A6480; --line:#DDE3EE; --grid:#DCE4F4;
    --cobalt:#2443C9; --cobalt-soft:#E6EBFC; --pen:#C2362B;
    --shadow: 0 1px 0 rgba(24,32,58,.04), 0 10px 24px -18px rgba(24,32,58,.35);
    --display:'Literata', Georgia, serif; --ui:'Public Sans', -apple-system, system-ui, sans-serif;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper:#0B1222; --bg:#0F1729; --ink:#E8EDF8; --muted:#9BA7C4; --line:#24304D; --grid:#18233F;
      --cobalt:#8EA6FF; --cobalt-soft:#17234A; --pen:#FF8A7D; --shadow:none;
      color-scheme: dark;
    }
  }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html, body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.45 var(--ui); -webkit-text-size-adjust:100%; -webkit-font-smoothing:antialiased; }
  body { position:relative; isolation:isolate; min-height:100dvh; padding: calc(env(safe-area-inset-top) + 24px) max(16px, env(safe-area-inset-right)) calc(env(safe-area-inset-bottom) + 24px) max(16px, env(safe-area-inset-left)); }
  /* Graph paper behind the top of the page, fading out, as on learn. */
  body::before {
    content:''; position:absolute; inset:0 0 auto 0; height:520px; z-index:-1; pointer-events:none;
    background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px);
    background-size:28px 28px;
    -webkit-mask-image: linear-gradient(to bottom, #000 40%, transparent); mask-image: linear-gradient(to bottom, #000 40%, transparent);
  }
  main { max-width:960px; margin:0 auto; }
  .eyebrow { font-size:13px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--cobalt); margin:8px 4px 6px; }
  h1 { font-family:var(--display); font-weight:600; font-size:36px; line-height:1.1; letter-spacing:-.015em; margin:0 4px 24px; }
  .grid { display:grid; gap:12px; grid-template-columns:repeat(2, minmax(0,1fr)); }
  @media (min-width:700px) { .grid { grid-template-columns:repeat(auto-fill, minmax(240px,1fr)); gap:16px; } h1 { font-size:44px; margin-bottom:32px; } }
  .card {
    all:unset; box-sizing:border-box; cursor:pointer; user-select:none; -webkit-user-select:none;
    display:flex; flex-direction:column; justify-content:space-between; gap:20px;
    min-height:140px; padding:16px; border-radius:14px;
    background:var(--bg); border:1px solid var(--line); box-shadow:var(--shadow);
    transition: transform .12s ease, border-color .12s ease;
  }
  @media (min-width:700px) { .card { min-height:160px; padding:20px; } }
  .card:active { transform:scale(.97); }
  @media (hover:hover) { .card:hover { border-color:var(--cobalt); } }
  .card:focus-visible { outline:2px solid var(--cobalt); outline-offset:3px; }
  .ic { width:44px; height:44px; border-radius:10px; background:var(--cobalt-soft); color:var(--cobalt); display:grid; place-items:center; }
  .ic svg { width:22px; height:22px; }
  .txt { display:flex; flex-direction:column; gap:2px; }
  .t { font-family:var(--display); font-size:19px; font-weight:600; }
  .s { font-size:14px; color:var(--muted); }
</style>
</head>
<body>
<main>
  <p class="eyebrow">Admin</p>
  <h1>Hi Chris</h1>
  <div class="grid">${CARDS.map(cardHtml).join('')}</div>
</main>
<script>
  // No-ops for now; each card gets wired up as its feature is built.
  document.querySelectorAll('button.card').forEach((c) => c.addEventListener('click', () => {}));
</script>
</body>
</html>`;
