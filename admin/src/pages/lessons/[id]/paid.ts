import type { APIRoute } from 'astro';
import { notFound, parseId, safeBack, seeOther } from '../../../lib/http';
import { markPaid } from '../../../lib/repo';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = parseId(params.id);
  if (!id) return notFound('That lesson');
  const back = safeBack((await request.formData()).get('back'), '/');
  const changed = await markPaid(locals.db, id, locals.today);
  return seeOther(back, changed ? 'paid' : 'nothing-to-pay');
};
