# Deploying and running it

One Cloudflare account, one Worker, one D1 database, one Access application. About fifteen minutes in the dashboard, once. No secrets anywhere.

## The account

Everything goes in the account that holds the Zero Trust organisation `withchris-team` and will hold the `withchris.uk` zone after the domain move (planned from about 20 October). That's the account PR #11's staging ran in. The public site's Worker is in the old account until the move; it stays there and keeps its Workers Builds until then.

Two phases:

| | Until the domain moves | After |
| --- | --- | --- |
| Hostname | `withchris-admin.<subdomain>.workers.dev` | `admin.withchris.uk` |
| `wrangler.jsonc` | `workers_dev: true`, `preview_urls: false` | `workers_dev: false`, `preview_urls: false`, and a `routes` entry with `custom_domain: true` |
| Access application | Self-hosted, on the `workers.dev` hostname | Self-hosted, on `admin.withchris.uk`. Edit the existing app's domain, or make a new one and update `ACCESS_AUD`. |

The second phase is two dashboard edits and one config change. Nothing else moves.

## Settings, set once

In this order. Until the last step, the Worker refuses every request, so nothing is exposed early.

1. **D1.** From `admin/`: `npx wrangler d1 create withchris-admin`. Put the id it prints into `wrangler.jsonc`. Location hint `weur`.
2. **Access application.** Zero Trust → Access → Applications → Self-hosted. Domain: the hostname for the current phase. Session duration: 24 hours. Policy: Allow, include Emails, `learn@withchris.uk`. Login method: One-time PIN (already configured on the organisation).
3. **Connect them.** Copy the team domain (`https://withchris-team.cloudflareaccess.com`) and the application's AUD tag into `wrangler.jsonc` as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, and set `ALLOWED_EMAILS` to the same email. Commit.
4. **Deploy.** Either of the two ways below.
5. **Check from outside.** `curl -I` the hostname: a 302 to the Access login. Sign in: the overview. A forged token header without signing in: still the Access login.

Optional, after the domain moves: turn on HSTS for the zone under SSL/TLS → Edge Certificates. It covers the public site too, which is already HTTPS-only.

`wrangler.jsonc`, in full:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "withchris-admin",
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_date": "2026-10-09",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": "./dist", "binding": "ASSETS" },
  "workers_dev": true,
  "preview_urls": false,
  "observability": { "enabled": true },
  "vars": {
    "ACCESS_TEAM_DOMAIN": "",
    "ACCESS_AUD": "",
    "ALLOWED_EMAILS": ""
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "withchris-admin", "database_id": "", "migrations_dir": "migrations" }
  ]
}
```

Empty strings refuse every request. That's deliberate.

## Deploys

**Workers Builds, recommended.** Workers & Pages → Create → Import a repository, this repo:

| Setting | Value |
| --- | --- |
| Project name | `withchris-admin` |
| Root directory | `admin` |
| Build command | `npm run build` |
| Deploy command | `npm run db:migrate && npx wrangler deploy` |
| Build watch paths | `admin/*`, `src/styles/*` |

`db:migrate` is `wrangler d1 migrations apply withchris-admin --remote`. It applies only migrations that haven't run yet, so it's safe on every deploy. If the token Workers Builds provisions can't apply D1 migrations, drop it from the deploy command and run `npm run db:migrate` from the laptop before pushing a migration. That's one command, rarely.

Also set the public site's build watch paths to leave `admin/*` out, so a change to the admin doesn't rebuild the site.

**From the laptop, the fallback.** `npx wrangler login` once, then `npm run deploy` (which is `npm run db:migrate && astro build && wrangler deploy`). If connecting the GitHub app to the new account is any trouble, use this and don't fight it. One person pushing one Worker doesn't need a pipeline.

## Local development

Needs Node 22 or newer. Nothing else.

```sh
cd admin
npm install
npx wrangler d1 migrations apply withchris-admin --local   # a local SQLite under .wrangler/
echo 'DEV_EMAIL=learn@withchris.uk' > .dev.vars              # dev-only sign-in, git-ignored
npm run dev                                                 # http://localhost:4321
```

`astro dev` uses wrangler's local bindings, so `env.DB` is the local SQLite. Repeat the migrate command after adding a migration.

## Continuous integration

One workflow, `.github/workflows/admin.yml`, tests only, no secrets, no deploy jobs, no environments. It runs on pull requests and pushes to `main` that touch `admin/**` or `src/styles/**`:

1. `npm ci`
2. `npm run check`
3. `npm run check:bundle`
4. `npm run test:unit`
5. `npx playwright install --with-deps chromium`
6. `npm run test:e2e`

Under 30 lines. Deploys are Workers Builds' job. The public site has no workflow; it keeps Workers Builds as it is on `main` today.

## Backups and recovery

D1 Time Travel keeps 30 days of history and restores to any minute: `wrangler d1 time-travel restore withchris-admin --timestamp=<ISO time>`. Before a migration that changes existing columns, note the time. That's the whole backup strategy, and it's more than a staging environment gave.

For a copy outside Cloudflare, `wrangler d1 export withchris-admin --remote --output=backup.sql` from the laptop, occasionally, kept somewhere private. The CSV export is also a backup of the part that matters for tax.

## Cost

| | PR #11 | This plan |
| --- | --- | --- |
| Workers | Paid, $5 a month | Free plan: 100,000 requests a day |
| Database | Supabase, $25 a month per project | D1 free: 5 GB, 5 million reads a day |
| Access | Free | Free |
| State storage, tokens, pooling | R2 bucket, three API tokens, Hyperdrive | None |
| Total | $30 to $55 a month | £0 |

If the account was moved to Workers Paid for the admin alone, move it back.

## Teardown of PR #11's infrastructure

Do this after the new admin is deployed and Chris has signed in. None of it holds real data; production was never built.

Delete:

- Supabase project `withchris-staging`, and the Supabase organisation and personal access token if nothing else uses them
- Hyperdrive config for staging
- Worker `withchris-admin-staging`
- Access application and policy for `withchris-admin-staging.withchris.workers.dev` (after the new application exists)
- R2 bucket `withchris-tfstate` and its API token
- The Cloudflare API token created for Terraform
- Keychain entries created by `infra/creds.sh`: `./infra/creds.sh list` on the `admin` branch shows them
- GitHub: pull request #11 closed without merging. Keep the `admin` branch until the new admin is merged, since the build salvages files from it. Then delete it.
- The old account's D1 database `withchris-admin` from revision 1, after the domain move, if it's still there

Keep:

- Zero Trust organisation `withchris-team` and its one-time PIN login method
- The `.agents/` tooling and the `CLOUDFLARE_API_KEY` it uses, which is unrelated

## Day to day

- Change the admin in a pull request. CI runs the tests. Merge. Workers Builds deploys.
- A new migration is a new file in `admin/migrations/`, applied locally for dev and tests, and on deploy for production.
- Nothing is managed in two places. The dashboard holds four settings and the repo holds everything else.
