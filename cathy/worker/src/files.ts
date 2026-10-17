// File types and limits for attachments and artifacts.

/** Biggest attachment or artifact: 25 MB (stored in D1 in 1 MB parts). */
export const MAX_FILE = 25 * 1024 * 1024;

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
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

/**
 * Headers for serving a stored file. Artifacts can be HTML with scripts, so they run in a
 * CSP sandbox: no cookies or storage of the serving site, no same-origin access, and
 * (in admin) no way to reach admin's API. Forms and popups stay off.
 */
export function fileHeaders(f: { filename: string; mime: string; size: number }, opts: { download?: boolean; cache?: string } = {}) {
  const inline = !opts.download && viewable(f.mime);
  const name = f.filename.replace(/[^\w.\- ]/g, '_');
  return {
    'content-type': f.mime,
    'content-length': String(f.size),
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
    'content-security-policy': "sandbox allow-scripts allow-modals allow-downloads; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': opts.cache ?? 'private, no-store',
  };
}

/** The public link for a shared artifact. */
export const shareUrl = (env: { SHARE_URL?: string }, token: string) => `${(env.SHARE_URL || 'https://withchris-share.withchris.workers.dev').replace(/\/$/, '')}/a/${token}`;
