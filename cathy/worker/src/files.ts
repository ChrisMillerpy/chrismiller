// File types, limits and serving rules for attachments and artifacts.

/** Biggest attachment or artifact: 25 MB. */
export const MAX_FILE = 25 * 1024 * 1024;
/** Most files on one message. */
export const MAX_FILES = 10;

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  tex: 'text/plain; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  py: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export const mimeFor = (filename: string) => TYPES[filename.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

/** Types a browser can show in place. Everything else downloads. */
export const viewable = (mime: string) => /^(text\/|image\/|application\/pdf|application\/json|video\/|audio\/)/.test(mime);
export const isMarkdown = (mime: string) => mime.startsWith('text/markdown');

/**
 * The CSP sandbox every stored file is served under. Artifacts can be HTML with scripts;
 * "sandbox" without allow-same-origin gives them an opaque origin: no cookies, no storage,
 * no same-origin requests, so a page served from admin can't call admin's API.
 */
export const SANDBOX_CSP = "sandbox allow-scripts allow-modals allow-downloads allow-popups; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'";

export function fileHeaders(f: { filename: string; mime: string; size: number }, opts: { download?: boolean; cache?: string } = {}) {
  const inline = !opts.download && viewable(f.mime);
  const name = f.filename.replace(/[^\w.\- ]/g, '_');
  return {
    'content-type': f.mime,
    'content-length': String(f.size),
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
    'content-security-policy': SANDBOX_CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': opts.cache ?? 'private, no-store',
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * A Markdown artifact as a page: house fonts and colours, maths with KaTeX
 * ($…$ and $$…$$), rendered in the browser by marked. The Markdown travels as JSON, so
 * nothing in it can break out of the page.
 */
export function markdownPage(title: string, markdown: string) {
  const data = JSON.stringify(markdown).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,500..600&family=Public+Sans:wght@400..600&display=swap">
<style>
  :root { --paper:#FAFBFD; --ink:#18203A; --muted:#5A6480; --line:#DDE3EE; --cobalt:#2443C9; --panel:#F1F4FA; color-scheme:light; }
  @media (prefers-color-scheme: dark) { :root { --paper:#0B1222; --ink:#E8EDF8; --muted:#9BA7C4; --line:#24304D; --cobalt:#8EA6FF; --panel:#131C33; color-scheme:dark; } }
  body { margin:0; background:var(--paper); color:var(--ink); font:17px/1.6 'Public Sans', system-ui, sans-serif; }
  main { max-width:720px; margin:0 auto; padding:32px 20px 64px; }
  h1, h2, h3 { font-family:Literata, Georgia, serif; font-weight:600; line-height:1.2; }
  h1 { font-size:34px; } a { color:var(--cobalt); }
  code { font:14px ui-monospace, monospace; background:var(--panel); border-radius:5px; padding:1px 5px; }
  pre { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px; overflow-x:auto; } pre code { background:none; padding:0; }
  table { border-collapse:collapse; } td, th { border:1px solid var(--line); padding:6px 10px; }
  img { max-width:100%; } blockquote { border-left:3px solid var(--cobalt); margin:0; padding-left:14px; color:var(--muted); }
  .katex-display { overflow-x:auto; overflow-y:hidden; }
  @media print { body { background:#fff; color:#000; } main { padding:0; } }
</style></head>
<body><main id="doc"></main>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<script>
  const md = ${data};
  // Keep maths away from Markdown (so _ and * inside it survive), then put it back for KaTeX.
  const maths = [];
  const hidden = md.replace(/\\$\\$[\\s\\S]+?\\$\\$|\\$[^$\\n]+?\\$/g, (m) => '@@M' + (maths.push(m) - 1) + '@@');
  const doc = document.getElementById('doc');
  doc.innerHTML = marked.parse(hidden).replace(/@@M(\\d+)@@/g, (_, i) => maths[i].replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]));
  renderMathInElement(doc, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false });
</script></body></html>`;
}

/** Serve a stored file: Markdown as a rendered page (unless downloading), anything else as itself. */
export function serveFile(f: { filename: string; mime: string; title?: string }, bytes: Uint8Array, opts: { download?: boolean; cache?: string; etag?: string } = {}) {
  const extra: Record<string, string> = opts.etag ? { etag: opts.etag } : {};
  if (isMarkdown(f.mime) && !opts.download) {
    const html = new TextEncoder().encode(markdownPage(f.title || f.filename, new TextDecoder().decode(bytes)));
    return new Response(html, { headers: { ...fileHeaders({ filename: f.filename.replace(/\.\w+$/, '.html'), mime: 'text/html; charset=utf-8', size: html.length }, opts), ...extra } });
  }
  return new Response(bytes, { headers: { ...fileHeaders({ filename: f.filename, mime: f.mime, size: bytes.length }, opts), ...extra } });
}

/** The public link for a shared artifact. */
export const shareUrl = (env: { SHARE_URL?: string }, token: string) => `${(env.SHARE_URL || 'https://withchris-share.withchris.workers.dev').replace(/\/$/, '')}/a/${token}`;
