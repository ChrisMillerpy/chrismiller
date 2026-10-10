import { describe, expect, it, vi } from 'vitest';
import { guard } from '../../src/lib/guard';

const url = 'https://admin.withchris.uk/students';
const signedIn = (email = 'chris@example.com') => vi.fn(async () => ({ email }));

describe('guard', () => {
  it('lets a verified email on the list through', async () => {
    expect(await guard(new Request(url), signedIn(), 'chris@example.com')).toEqual({ ok: true, email: 'chris@example.com' });
  });

  it('compares emails case-insensitively and ignores spaces in the list', async () => {
    const r = await guard(new Request(url), signedIn('Chris@Example.com'), ' someone@example.com, CHRIS@example.com ');
    expect(r).toEqual({ ok: true, email: 'chris@example.com' });
  });

  it('refuses a cross-site post before checking anything else', async () => {
    const verify = signedIn();
    const r = await guard(new Request(url, { method: 'POST', headers: { origin: 'https://evil.example' } }), verify, 'chris@example.com');
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(verify).not.toHaveBeenCalled();
  });

  it('refuses when the Access token does not verify', async () => {
    expect(await guard(new Request(url), vi.fn(async () => null), 'chris@example.com')).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a verified email that is not on the list', async () => {
    expect(await guard(new Request(url), signedIn('stranger@example.com'), 'chris@example.com')).toMatchObject({ ok: false, status: 403 });
  });

  it.each(['', ' ', ','])('lets nobody in when the list is %j', async (list) => {
    expect(await guard(new Request(url), signedIn(), list)).toMatchObject({ ok: false, status: 403 });
  });
});
