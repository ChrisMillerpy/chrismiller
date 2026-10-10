import type { APIRoute } from 'astro';
import { need, notFound, parseId, seeOther } from '../../../lib/http';
import { markAllPaid } from '../../../lib/repo';

export const POST: APIRoute = async ({ params, locals }) => {
  const denied = need(locals.staff, 'finance.write');
  if (denied) return denied;
  const id = parseId(params.id);
  if (!id) return notFound('That student');
  const count = await locals.db((tx) => markAllPaid(tx, id, locals.today));
  return seeOther(`/students/${id}`, count ? 'all-paid' : 'nothing-to-pay');
};
