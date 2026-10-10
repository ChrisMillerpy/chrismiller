import { describe, expect, it } from 'vitest';
import { errorResponse, need, NOTICES, parseId, seeOther } from '../../src/lib/http';

describe('parseId', () => {
  it.each([['1', 1], ['42', 42]])('accepts %j', (s, n) => expect(parseId(s)).toBe(n));
  it.each([undefined, '', '0', '-1', '1.5', '01', 'abc', '1e3', '99999999999999999'])('rejects %j', (s) => {
    expect(parseId(s)).toBeNull();
  });
});

describe('seeOther', () => {
  it('redirects with 303', () => {
    const r = seeOther('/students/1');
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/students/1');
  });
  it('adds a notice key', () => {
    expect(seeOther('/lessons?view=unpaid', 'paid').headers.get('location')).toBe('/lessons?view=unpaid&notice=paid');
  });
  it('only uses known notice keys in the app', () => {
    expect(Object.keys(NOTICES)).toContain('paid');
  });
});

describe('need', () => {
  it('returns null when allowed and 403 when not', () => {
    expect(need({ id: 1, name: 'C', permissions: ['*'] }, 'finance.write')).toBeNull();
    expect(need({ id: 1, name: 'C', permissions: [] }, 'finance.write')?.status).toBe(403);
  });
});

describe('errorResponse', () => {
  it('escapes the message', async () => {
    const r = errorResponse(403, '<script>');
    expect(r.status).toBe(403);
    expect(await r.text()).toContain('&#60;script&#62;');
  });
});

import { safeBack } from '../../src/lib/http';

describe('safeBack', () => {
  it('keeps local paths', () => {
    expect(safeBack('/lessons?view=unpaid', '/')).toBe('/lessons?view=unpaid');
  });
  it.each([null, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)'])(
    'falls back for %j',
    (v) => expect(safeBack(v, '/')).toBe('/'),
  );
});
