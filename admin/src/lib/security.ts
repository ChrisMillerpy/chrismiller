const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Unsafe methods must come from a page on this same origin. A missing or "null" Origin is refused. */
export function isAllowedRequest(request: Request): boolean {
  if (SAFE_METHODS.has(request.method)) return true;
  return request.headers.get('origin') === new URL(request.url).origin;
}

const HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  // no-referrer would make Chrome send `Origin: null` on our own form posts.
  'referrer-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

export function withSecurityHeaders(response: Response): Response {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(HEADERS)) r.headers.set(k, v);
  return r;
}
