// Money is always integer pence. Pounds only exist at the edges: forms in, display out.

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

export function formatPence(pence: number): string {
  return gbp.format(pence / 100);
}

/** Parses "45", "45.5", "£1,200.00" into pence. Returns null for anything else, including negatives. */
export function parsePounds(input: string): number | null {
  const s = input.trim().replace(/^£/, '').replaceAll(',', '');
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** Pence as a plain pounds string for form inputs: 4500 → "45.00". */
export function penceToInput(pence: number): string {
  return (pence / 100).toFixed(2);
}
