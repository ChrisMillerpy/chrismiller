import type { APIRoute } from 'astro';
import { toCsv } from '../lib/csv';
import { errorResponse } from '../lib/http';
import { EXPORT_COLUMNS, exportLessons } from '../lib/repo';
import { taxYearLabel, taxYearRange } from '../lib/taxyear';
import { isIsoDate } from '../lib/validate';

// GET /export.csv                      everything
// GET /export.csv?tax_year=2026        6 April 2026 to 5 April 2027
// GET /export.csv?from=…&to=…          a date range
export const GET: APIRoute = async ({ url, locals }) => {
  const q = url.searchParams;
  let from: string | null = null;
  let to: string | null = null;
  let name = 'lessons-all';

  const year = q.get('tax_year');
  if (year !== null) {
    if (!/^20\d\d$/.test(year)) return errorResponse(400, 'tax_year must be a year like 2026.');
    ({ from, to } = taxYearRange(Number(year)));
    name = `lessons-${taxYearLabel(Number(year)).replace('–', '-')}`;
  } else if (q.has('from') || q.has('to')) {
    from = q.get('from');
    to = q.get('to');
    if (!from || !to || !isIsoDate(from) || !isIsoDate(to) || from > to) {
      return errorResponse(400, 'from and to must both be dates, with from on or before to.');
    }
    name = `lessons-${from}-to-${to}`;
  }

  const rows = await exportLessons(locals.db, from, to);
  // The byte-order mark makes Excel read the file as UTF-8, so "Zoë" stays "Zoë".
  const csv = '﻿' + toCsv([...EXPORT_COLUMNS], rows.map((r) => EXPORT_COLUMNS.map((c) => r[c])));
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}.csv"`,
    },
  });
};
