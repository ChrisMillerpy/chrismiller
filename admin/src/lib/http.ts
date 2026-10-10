// Small response helpers for pages and endpoints.

import { can, type Permission } from './permissions';
import type { StaffMember } from './db';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function errorResponse(status: number, message: string): Response {
  const title = { 403: 'No access', 404: 'Not found', 503: 'Unavailable' }[status] ?? 'Error';
  return new Response(
    `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
      `<body style="font:17px/1.6 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 16px;color:#18203A">` +
      `<h1 style="font-size:1.6rem">${title}</h1><p>${escape(message)}</p>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

/** A 403 response if the staff member lacks the permission, else null. */
export function need(staff: StaffMember, permission: Permission): Response | null {
  return can(staff, permission) ? null : errorResponse(403, `You need the ${permission} permission for this page.`);
}

export function notFound(what = 'That page'): Response {
  return errorResponse(404, `${what} doesn't exist, or has been deleted.`);
}

/** After a successful form post: redirect, so a refresh doesn't post again. */
export function seeOther(path: string, notice?: string): Response {
  const url = notice ? `${path}${path.includes('?') ? '&' : '?'}notice=${encodeURIComponent(notice)}` : path;
  return new Response(null, { status: 303, headers: { location: url } });
}

export function parseId(param: string | undefined): number | null {
  return param && /^[1-9]\d{0,15}$/.test(param) ? Number(param) : null;
}

/** Notices shown after a redirect. Only these fixed messages can appear, never arbitrary text. */
export const NOTICES: Record<string, string> = {
  'student-saved': 'Student saved.',
  'student-deleted': 'Student and their lessons deleted.',
  'lesson-saved': 'Lesson saved.',
  'lesson-deleted': 'Lesson deleted.',
  'paid': 'Marked as paid.',
  'all-paid': 'All past lessons marked as paid.',
  'nothing-to-pay': 'Nothing was unpaid.',
};

/** A redirect target from a form field, only if it's a path on this site. */
export function safeBack(value: FormDataEntryValue | null, fallback: string): string {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : fallback;
}
