import { describe, expect, it, vi } from 'vitest';
import { guard } from '../../src/lib/guard';

const chris = { id: 1, name: 'Chris', permissions: ['*'] };
const url = 'https://admin.withchris.uk/students';

function deps(over: Partial<Parameters<typeof guard>[1]> = {}) {
  return {
    verify: vi.fn(async () => ({ email: 'chris@example.com' })),
    lookup: vi.fn(async () => chris),
    ...over,
  };
}

describe('guard', () => {
  it('lets a verified, known staff member through', async () => {
    const d = deps();
    expect(await guard(new Request(url), d)).toEqual({ ok: true, staff: chris, email: 'chris@example.com' });
    expect(d.lookup).toHaveBeenCalledWith('chris@example.com');
  });

  it('refuses a cross-site post before checking anything else', async () => {
    const d = deps();
    const r = await guard(new Request(url, { method: 'POST', headers: { origin: 'https://evil.example' } }), d);
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(d.verify).not.toHaveBeenCalled();
  });

  it('refuses when the Access token does not verify', async () => {
    const d = deps({ verify: vi.fn(async () => null) });
    expect(await guard(new Request(url), d)).toMatchObject({ ok: false, status: 403 });
    expect(d.lookup).not.toHaveBeenCalled();
  });

  it('refuses a verified email that is not active staff', async () => {
    const d = deps({ lookup: vi.fn(async () => null) });
    expect(await guard(new Request(url), d)).toMatchObject({ ok: false, status: 403 });
  });

  it('fails closed if the staff lookup throws', async () => {
    const d = deps({ lookup: vi.fn(async () => { throw new Error('db down'); }) });
    expect(await guard(new Request(url), d)).toMatchObject({ ok: false, status: 503 });
  });
});
