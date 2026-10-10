// Every request: refuse anything not from an allowed, signed-in email, then hand the page the database.

import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { createAccessVerifier, type AccessVerifier } from './lib/access';
import { guard } from './lib/guard';
import { errorResponse } from './lib/http';
import { withSecurityHeaders } from './lib/security';
import { todayInLondon } from './lib/taxyear';

// The verifier caches Access's signing keys, so keep it across requests.
let verifier: { key: string; verify: AccessVerifier } | undefined;
function getVerifier(): AccessVerifier {
  // `astro dev` only: sign in as DEV_EMAIL from .dev.vars, since a browser can't add the
  // Access header. import.meta.env.DEV is false at build time, so this is removed from every
  // deployed bundle (CI checks: npm run check:bundle).
  if (import.meta.env.DEV && env.DEV_EMAIL) {
    const email = env.DEV_EMAIL.toLowerCase();
    return async () => ({ email });
  }
  const key = `${env.ACCESS_TEAM_DOMAIN}|${env.ACCESS_AUD}`;
  if (verifier?.key !== key) {
    verifier = { key, verify: createAccessVerifier({ teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD }) };
  }
  return verifier.verify;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const result = await guard(context.request, getVerifier(), env.ALLOWED_EMAILS);
  if (!result.ok) return withSecurityHeaders(errorResponse(result.status, result.message));

  context.locals.email = result.email;
  context.locals.today = todayInLondon();
  context.locals.db = env.DB;
  try {
    return withSecurityHeaders(await next());
  } catch (error) {
    // Logged for `wrangler tail` and the dashboard; the browser only gets a fixed message.
    console.error(error);
    return withSecurityHeaders(errorResponse(500, 'Something went wrong. The error has been logged.'));
  }
});
