import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAccessVerifier } from '../../src/lib/access';

const teamDomain = 'https://withchris.cloudflareaccess.com';
const aud = 'aud-tag-123';

let goodKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const good = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256', { extractable: true });
  goodKey = good.privateKey;
  otherKey = other.privateKey;
  const pub: JWK = { ...(await exportJWK(good.publicKey)), kid: 'k1', alg: 'RS256' };
  jwks = createLocalJWKSet({ keys: [pub] });
});

async function token(opts: { key?: CryptoKey; aud?: string; iss?: string; email?: string | null; exp?: string } = {}) {
  const claims: Record<string, unknown> = { type: 'app' };
  if (opts.email !== null) claims.email = opts.email ?? 'Chris@Example.com';
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? teamDomain)
    .setAudience(opts.aud ?? aud)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.key ?? goodKey);
}

function req(jwt?: string) {
  const headers = new Headers();
  if (jwt) headers.set('cf-access-jwt-assertion', jwt);
  return new Request('https://admin.withchris.uk/', { headers });
}

describe('createAccessVerifier', () => {
  it('accepts a valid token and returns the lower-cased email', async () => {
    const verify = createAccessVerifier({ teamDomain, aud, jwks });
    expect(await verify(req(await token()))).toEqual({ email: 'chris@example.com' });
  });

  it('refuses a request with no token', async () => {
    const verify = createAccessVerifier({ teamDomain, aud, jwks });
    expect(await verify(req())).toBeNull();
  });

  it.each([
    ['wrong audience', { aud: 'other' }],
    ['wrong issuer', { iss: 'https://evil.cloudflareaccess.com' }],
    ['expired', { exp: '-1m' }],
    ['no email', { email: null }],
  ])('refuses a token with %s', async (_, opts) => {
    const verify = createAccessVerifier({ teamDomain, aud, jwks });
    expect(await verify(req(await token(opts as never)))).toBeNull();
  });

  it('refuses a token signed by another key', async () => {
    const verify = createAccessVerifier({ teamDomain, aud, jwks });
    expect(await verify(req(await token({ key: otherKey })))).toBeNull();
  });

  it('refuses garbage', async () => {
    const verify = createAccessVerifier({ teamDomain, aud, jwks });
    expect(await verify(req('not.a.jwt'))).toBeNull();
  });

  it.each([
    ['no team domain', { teamDomain: '', aud }],
    ['no AUD tag', { teamDomain, aud: '' }],
  ])('fails closed with %s', async (_, config) => {
    const verify = createAccessVerifier({ ...config, jwks });
    expect(await verify(req(await token()))).toBeNull();
  });

  it('tolerates a trailing slash on the team domain', async () => {
    const verify = createAccessVerifier({ teamDomain: `${teamDomain}/`, aud, jwks });
    expect(await verify(req(await token()))).toEqual({ email: 'chris@example.com' });
  });
});
