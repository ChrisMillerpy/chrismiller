// Dates are plain 'YYYY-MM-DD' strings in UK local time. The UK tax year runs 6 April to 5 April.

/** The year the tax year containing `date` starts in. */
export function taxYearOf(date: string): number {
  const year = Number(date.slice(0, 4));
  return date.slice(5) >= '04-06' ? year : year - 1;
}

export function taxYearRange(startYear: number): { from: string; to: string } {
  return { from: `${startYear}-04-06`, to: `${startYear + 1}-04-05` };
}

export function taxYearLabel(startYear: number): string {
  return `${startYear}–${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** The current tax year and the two before it, newest first. */
export function recentTaxYears(today: string): number[] {
  const current = taxYearOf(today);
  return [current, current - 1, current - 2];
}

export function monthRange(date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

const londonDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function todayInLondon(now: Date = new Date()): string {
  return londonDate.format(now);
}
