// Every request: refuse anything not from signed-in staff, then give the page a database
// handle that runs under that staff member's RLS claims.

import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { createAccessVerifier, type AccessVerifier } from './lib/access';
import { connect, lookupStaff, withStaff } from './lib/db';
import { guard } from './lib/guard';
import { errorResponse } from './lib/http';
import { withSecurityHeaders } from './lib/security';
import { todayInLondon } from './lib/taxyear';

// The verifier caches Access's signing keys, so keep it across requests.
let verifier: { key: string; verify: AccessVerifier } | undefined;
function getVerifier(): AccessVerifier {
  // `astro dev` only: sign in as DEV_STAFF_EMAIL from .dev.vars, since a browser can't add the
  // Access header. import.meta.env.DEV is false at build time, so this is removed from every
  // deployed bundle (CI checks: npm run check:bundle).
  if (import.meta.env.DEV && env.DEV_STAFF_EMAIL) {
    const email = env.DEV_STAFF_EMAIL.toLowerCase();
    return async () => ({ email });
  }
  const key = `${env.ACCESS_TEAM_DOMAIN}|${env.ACCESS_AUD}`;
  if (verifier?.key !== key) {
    verifier = { key, verify: createAccessVerifier({ teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD }) };
  }
  return verifier.verify;
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Hyperdrive pools the real connections; a client per request is the recommended pattern.
  const sql = connect(env.HYPERDRIVE.connectionString);
  try {
    const result = await guard(context.request, { verify: getVerifier(), lookup: (email) => lookupStaff(sql, email) });
    if (!result.ok) return withSecurityHeaders(errorResponse(result.status, result.message));

    context.locals.staff = result.staff;
    context.locals.email = result.email;
    context.locals.today = todayInLondon();
    context.locals.db = (fn) => withStaff(sql, result.staff.id, fn);
    return withSecurityHeaders(await next());
  } finally {
    context.locals.cfContext.waitUntil(sql.end({ timeout: 5 }));
  }
});
