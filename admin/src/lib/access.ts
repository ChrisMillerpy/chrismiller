// Second lock behind Cloudflare Access: verify the signed token Access adds to every request.
// Missing configuration means every request is refused.

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface AccessConfig {
  teamDomain: string;
  aud: string;
  /** Defaults to the team's published signing keys. Tests pass a local key set. */
  jwks?: JWTVerifyGetKey;
}

export type AccessVerifier = (request: Request) => Promise<{ email: string } | null>;

export function createAccessVerifier(config: AccessConfig): AccessVerifier {
  const teamDomain = config.teamDomain.replace(/\/+$/, '');
  if (!teamDomain || !config.aud) return async () => null;
  const jwks = config.jwks ?? createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));

  return async (request) => {
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: teamDomain,
        audience: config.aud,
        algorithms: ['RS256'],
      });
      if (typeof payload.email !== 'string' || !payload.email) return null;
      return { email: payload.email.toLowerCase() };
    } catch {
      return null;
    }
  };
}
