// Stands in for Cloudflare Access in end-to-end tests: publishes a signing key where the admin
// expects Access's keys, and mints tokens on request. Never deployed.

import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const port = Number(process.env.FAKE_ACCESS_PORT ?? 4401);
const issuer = `http://127.0.0.1:${port}`;
const aud = process.env.FAKE_ACCESS_AUD ?? 'e2e-aud';
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'e2e', alg: 'RS256', use: 'sig' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', issuer);
  if (url.pathname === '/cdn-cgi/access/certs') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
  } else if (url.pathname === '/token') {
    const token = await new SignJWT({ email: url.searchParams.get('email'), type: 'app' })
      .setProtectedHeader({ alg: 'RS256', kid: 'e2e' })
      .setIssuer(issuer)
      .setAudience(url.searchParams.get('aud') ?? aud)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    res.writeHead(200, { 'content-type': 'text/plain' }).end(token);
  } else if (url.pathname === '/health') {
    res.writeHead(200).end('ok');
  } else {
    res.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => console.log(`fake Access on ${issuer}`));
