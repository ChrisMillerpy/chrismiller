import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../../src/lib/csv';

describe('csvCell', () => {
  it('leaves plain values alone', () => {
    expect(csvCell('Alice')).toBe('Alice');
    expect(csvCell(42)).toBe('42');
  });
  it('writes null and undefined as empty', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });
  it.each(['=SUM(A1)', '+1', '-1', '@cmd', '\t=x', '\r=x'])('neutralises formula-like %j', (value) => {
    expect(csvCell(value).replace(/^"|"$/g, '').startsWith("'")).toBe(true);
  });
  it('does not touch negative numbers passed as numbers', () => {
    expect(csvCell(-5)).toBe('-5');
  });
});

describe('toCsv', () => {
  it('joins a header and rows with CRLF', () => {
    expect(toCsv(['a', 'b'], [[1, 'x,y'], [null, '=1']])).toBe('a,b\r\n1,"x,y"\r\n,\'=1\r\n');
  });
});
