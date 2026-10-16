// Admin Worker: Chris's home screen for the tools we build.
// Deliberately simple: optional password (basic auth), no database.

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
      return new Response(ICON, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
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

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#1a1a1a"/><text x="256" y="330" font-family="system-ui,sans-serif" font-size="260" font-weight="700" fill="#fafaf7" text-anchor="middle">C</text></svg>`;

const MANIFEST = {
  name: 'Chris Admin',
  short_name: 'Admin',
  start_url: '/',
  display: 'standalone',
  background_color: '#fafaf7',
  theme_color: '#fafaf7',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
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
<meta name="theme-color" content="#fafaf7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121212" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg">
<link rel="apple-touch-icon" href="/icon.svg">
<title>Admin</title>
<style>
  :root {
    --bg:#fafaf7; --fg:#1a1a1a; --muted:#6b6b66; --card:#fff; --line:#e6e5df; --ic:#f1f0ea;
    --shadow: 0 1px 2px rgba(0,0,0,.04), 0 2px 8px rgba(0,0,0,.04);
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#121212; --fg:#ededed; --muted:#9a9a95; --card:#1c1c1c; --line:#2a2a2a; --ic:#262626; --shadow:none; }
  }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html, body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.4 -apple-system, system-ui, sans-serif; -webkit-text-size-adjust:100%; }
  body { min-height:100dvh; padding: calc(env(safe-area-inset-top) + 20px) max(16px, env(safe-area-inset-right)) calc(env(safe-area-inset-bottom) + 24px) max(16px, env(safe-area-inset-left)); }
  main { max-width:960px; margin:0 auto; }
  h1 { font-size:32px; font-weight:700; letter-spacing:-.02em; margin:8px 4px 20px; }
  .grid { display:grid; gap:12px; grid-template-columns:repeat(2, minmax(0,1fr)); }
  @media (min-width:700px) { .grid { grid-template-columns:repeat(auto-fill, minmax(240px,1fr)); gap:16px; } h1 { font-size:36px; margin-bottom:28px; } }
  .card {
    all:unset; box-sizing:border-box; cursor:pointer; user-select:none; -webkit-user-select:none;
    display:flex; flex-direction:column; justify-content:space-between; gap:20px;
    min-height:140px; padding:16px; border-radius:20px;
    background:var(--card); border:1px solid var(--line); box-shadow:var(--shadow);
    transition: transform .12s ease, background-color .12s ease;
  }
  @media (min-width:700px) { .card { min-height:160px; padding:20px; } }
  .card:active { transform:scale(.97); }
  @media (hover:hover) { .card:hover { background:var(--ic); } }
  .card:focus-visible { outline:2px solid var(--fg); outline-offset:2px; }
  .ic { width:44px; height:44px; border-radius:12px; background:var(--ic); display:grid; place-items:center; }
  .ic svg { width:22px; height:22px; }
  .txt { display:flex; flex-direction:column; gap:2px; }
  .t { font-size:17px; font-weight:600; }
  .s { font-size:14px; color:var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Hi Chris</h1>
  <div class="grid">${CARDS.map(cardHtml).join('')}</div>
</main>
<script>
  // No-ops for now; each card gets wired up as its feature is built.
  document.querySelectorAll('button.card').forEach((c) => c.addEventListener('click', () => {}));
</script>
</body>
</html>`;
