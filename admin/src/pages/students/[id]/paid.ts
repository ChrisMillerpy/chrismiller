import type { APIRoute } from 'astro';
import { notFound, parseId, seeOther } from '../../../lib/http';
import { markAllPaid } from '../../../lib/repo';

export const POST: APIRoute = async ({ params, locals }) => {
  const id = parseId(params.id);
  if (!id) return notFound('That student');
  const count = await markAllPaid(locals.db, id, locals.today);
  return seeOther(`/students/${id}`, count ? 'all-paid' : 'nothing-to-pay');
};
