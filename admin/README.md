# admin.withchris.uk

A tiny private Worker. For now it just says "Hi Chris". Separate from the public site so nothing here can leak into it.

Login is **Cloudflare Access** (dashboard setting, no code): only Chris's email gets in, via a one-time code. Deliberately simple — harden it when there's real data behind it.

## Deploy

```sh
cd admin
npx wrangler deploy
```

Or connect it in Workers Builds with root directory `admin` and deploy command `npx wrangler deploy`.

## Access setup (one time)

Zero Trust → Access → Applications → Add → Self-hosted:

- Domain: `admin.withchris.uk`
- Policy: Allow, Include → Emails → Chris's email
- Login method: One-time PIN
