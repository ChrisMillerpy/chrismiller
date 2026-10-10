// Who is this request from, and may they in? Runs before any page.
// Order: same-origin check, Access token, the ALLOWED_EMAILS list. Any failure refuses the request.

import { isAllowedRequest } from './security';
import type { AccessVerifier } from './access';

export type GuardResult = { ok: true; email: string } | { ok: false; status: 403; message: string };

export async function guard(request: Request, verify: AccessVerifier, allowedEmails: string): Promise<GuardResult> {
  if (!isAllowedRequest(request)) return { ok: false, status: 403, message: 'Cross-site request refused.' };

  const identity = await verify(request);
  if (!identity) return { ok: false, status: 403, message: 'Not signed in through Cloudflare Access.' };

  // An empty list lets nobody in.
  const allowed = allowedEmails.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const email = identity.email.toLowerCase();
  if (!allowed.includes(email)) return { ok: false, status: 403, message: 'This account has no access to the admin.' };

  return { ok: true, email };
}
