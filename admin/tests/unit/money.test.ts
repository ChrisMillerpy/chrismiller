import { describe, expect, it } from 'vitest';
import { formatPence, parsePounds } from '../../src/lib/money';

describe('formatPence', () => {
  it('formats whole pounds with pence', () => {
    expect(formatPence(4000)).toBe('£40.00');
  });
  it('formats pence and thousands', () => {
    expect(formatPence(123456)).toBe('£1,234.56');
  });
  it('formats zero', () => {
    expect(formatPence(0)).toBe('£0.00');
  });
});

describe('parsePounds', () => {
  it.each([
    ['40', 4000],
    ['40.5', 4050],
    ['40.50', 4050],
    ['£45', 4500],
    [' 0 ', 0],
    ['1,200', 120000],
  ])('parses %j as %i pence', (input, pence) => {
    expect(parsePounds(input)).toBe(pence);
  });

  it.each(['', 'abc', '-5', '1.234', '1e3', '40.5.0'])('rejects %j', (input) => {
    expect(parsePounds(input)).toBeNull();
  });

  it('avoids floating point error', () => {
    expect(parsePounds('0.29')).toBe(29);
    expect(parsePounds('19.99')).toBe(1999);
  });
});

import { penceToInput } from '../../src/lib/money';

describe('penceToInput', () => {
  it('round-trips through parsePounds', () => {
    for (const p of [0, 1, 99, 4500, 123456]) expect(parsePounds(penceToInput(p))).toBe(p);
  });
});
