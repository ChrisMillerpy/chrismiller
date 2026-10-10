import { describe, expect, it } from 'vitest';
import { monthRange, recentTaxYears, taxYearLabel, taxYearOf, taxYearRange, todayInLondon } from '../../src/lib/taxyear';

describe('taxYearOf', () => {
  it.each([
    ['2026-04-05', 2025],
    ['2026-04-06', 2026],
    ['2027-01-01', 2026],
    ['2026-12-31', 2026],
    ['2026-03-31', 2025],
  ])('%s is in the tax year starting %i', (date, year) => {
    expect(taxYearOf(date)).toBe(year);
  });
});

describe('taxYearRange', () => {
  it('runs 6 April to 5 April', () => {
    expect(taxYearRange(2026)).toEqual({ from: '2026-04-06', to: '2027-04-05' });
  });
});

describe('taxYearLabel', () => {
  it('uses the HMRC style', () => {
    expect(taxYearLabel(2026)).toBe('2026–27');
    expect(taxYearLabel(2099)).toBe('2099–00');
  });
});

describe('recentTaxYears', () => {
  it('lists the current tax year and the two before it, newest first', () => {
    expect(recentTaxYears('2026-10-10')).toEqual([2026, 2025, 2024]);
    expect(recentTaxYears('2026-04-01')).toEqual([2025, 2024, 2023]);
  });
});

describe('monthRange', () => {
  it('covers the calendar month', () => {
    expect(monthRange('2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02-14')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('todayInLondon', () => {
  it('uses the UK date, not UTC', () => {
    // 23:30 UTC on 30 June is 00:30 BST on 1 July.
    expect(todayInLondon(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01');
    // In winter the UK is on UTC.
    expect(todayInLondon(new Date('2026-12-31T23:30:00Z'))).toBe('2026-12-31');
  });
});
