# admin.withchris.uk

A tiny private Worker. For now it just says "Hi Chris". Separate from the public site so nothing here can leak into it.

Login is **Cloudflare Access** in production: only `learn@withchris.uk` gets in, via a one-time code. The Worker also checks Access's token itself (`src/auth.ts`) when `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set in `wrangler.jsonc`. Without them (previews, local dev) it uses the cookie password (`ADMIN_PASSWORD`). Dashboard steps are in the root README, under "Cloudflare Access".

## Deploy

```sh
cd admin
npx wrangler deploy
```

Or connect it in Workers Builds with root directory `admin` and deploy command `npx wrangler deploy`.

