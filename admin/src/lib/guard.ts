// Who is this request from, and may they in? Runs before any page.
// Order: same-origin check, Access token, staff record. Any failure refuses the request.

import { isAllowedRequest } from './security';
import type { AccessVerifier } from './access';
import type { StaffMember } from './db';

export type GuardResult =
  | { ok: true; staff: StaffMember; email: string }
  | { ok: false; status: 403 | 503; message: string };

export async function guard(
  request: Request,
  deps: { verify: AccessVerifier; lookup: (email: string) => Promise<StaffMember | null> },
): Promise<GuardResult> {
  if (!isAllowedRequest(request)) return { ok: false, status: 403, message: 'Cross-site request refused.' };

  const identity = await deps.verify(request);
  if (!identity) return { ok: false, status: 403, message: 'Not signed in through Cloudflare Access.' };

  let staff: StaffMember | null;
  try {
    staff = await deps.lookup(identity.email);
  } catch {
    return { ok: false, status: 503, message: 'The database is unavailable. Try again shortly.' };
  }
  if (!staff) return { ok: false, status: 403, message: 'This account has no access to the admin.' };

  return { ok: true, staff, email: identity.email };
}
