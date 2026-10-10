import { describe, expect, it } from 'vitest';
import { isAllowedRequest, withSecurityHeaders } from '../../src/lib/security';

const origin = 'https://admin.withchris.uk';

function req(method: string, headers: Record<string, string> = {}) {
  return new Request(`${origin}/students`, { method, headers });
}

describe('isAllowedRequest', () => {
  it('allows safe methods without an Origin', () => {
    expect(isAllowedRequest(req('GET'))).toBe(true);
    expect(isAllowedRequest(req('HEAD'))).toBe(true);
  });
  it('allows posts from the same origin', () => {
    expect(isAllowedRequest(req('POST', { origin }))).toBe(true);
  });
  it('refuses posts from elsewhere, from null, or with no Origin', () => {
    expect(isAllowedRequest(req('POST', { origin: 'https://evil.example' }))).toBe(false);
    expect(isAllowedRequest(req('POST', { origin: 'null' }))).toBe(false);
    expect(isAllowedRequest(req('POST'))).toBe(false);
  });
  it('refuses other unsafe methods from elsewhere', () => {
    expect(isAllowedRequest(req('DELETE', { origin: 'https://evil.example' }))).toBe(false);
  });
});

describe('withSecurityHeaders', () => {
  it('adds the hardening headers', () => {
    const r = withSecurityHeaders(new Response('hi'));
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('referrer-policy')).toBe('same-origin');
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
  it('keeps the status and body', async () => {
    const r = withSecurityHeaders(new Response('gone', { status: 404 }));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe('gone');
  });
});
