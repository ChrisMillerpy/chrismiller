import type { APIRoute } from 'astro';
import { need, notFound, parseId, safeBack, seeOther } from '../../../lib/http';
import { markPaid } from '../../../lib/repo';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const denied = need(locals.staff, 'finance.write');
  if (denied) return denied;
  const id = parseId(params.id);
  if (!id) return notFound('That lesson');
  const back = safeBack((await request.formData()).get('back'), '/');
  await locals.db((tx) => markPaid(tx, id, locals.today));
  return seeOther(back, 'paid');
};
