// The shared page shell for every admin page: head tags, theme, base styles.
import THEME from '../../shared/theme.css';

export const BASE_CSS = `
  /* Admin-only extras; colours and fonts come from shared/theme.css. */
  :root { --shadow: 0 1px 0 rgba(24,32,58,.04), 0 10px 24px -18px rgba(24,32,58,.35); }
  @media (prefers-color-scheme: dark) { :root { --shadow: none; } }
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
  @media (min-width:700px) { h1 { font-size:44px; margin-bottom:32px; } }
  .back { display:inline-block; color:var(--cobalt); text-decoration:none; font-weight:600; font-size:15px; margin:0 4px 10px; }
  button, .btn { font:inherit; }
`;

export function page({ title, css = '', body, script = '' }: { title: string; css?: string; body: string; script?: string }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
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
<title>${title}</title>
<style>${THEME}</style>
<style>${BASE_CSS}${css}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}

export const htmlResponse = (html: string) =>
  new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } });
