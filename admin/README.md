# The admin

A private site at `admin.withchris.uk` for running the tutoring business: students, the lessons taught to them, and who has paid. One user. Astro, server-rendered on one Cloudflare Worker, with a D1 database and Cloudflare Access in front. No secrets anywhere.

Why it's built this way, and the line budgets it's held to, are in [`plans/admin-simple/`](../plans/admin-simple/README.md).

## How a request gets in

1. **Cloudflare Access** guards the hostname. Only the emails in its policy get a one-time code.
2. **`src/lib/guard.ts`** runs on every request, before any page:
   - a POST must carry an `Origin` equal to this site's;
   - the `Cf-Access-Jwt-Assertion` token must verify against the team's keys (RS256, issuer, audience);
   - the token's email must be in `ALLOWED_EMAILS`.
3. **`src/middleware.ts`** hands the page `locals.db` (the D1 binding), adds the security headers to every response, and turns a thrown error into a logged, fixed 500.

`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `ALLOWED_EMAILS` live in `wrangler.jsonc`. If any of them is empty, every request is refused.

## Local development

Needs Node 22.12 or newer.

```sh
npm install                                                 # the site's packages too: see Gotchas
cd admin
npm install
npx wrangler d1 migrations apply withchris-admin --local   # a local SQLite under .wrangler/state
printf 'DEV_EMAIL=you@example.com\nALLOWED_EMAILS=you@example.com\n' > .dev.vars
npm run dev                                                 # http://localhost:4321
```

Under `astro dev` only, `DEV_EMAIL` signs you in without Access. The allow-list still applies, so the email must also be in `ALLOWED_EMAILS`. Run the migrate command again after adding a migration.

## Tests

| Command | What |
| --- | --- |
| `npm run test:unit` | Money, tax year, CSV, validation, forms, Access tokens, the guard, security and HTTP helpers |
| `npm run test:e2e` | The production build behind a fake Access server, against a fresh local D1. Run `npx playwright install chromium` once first. |
| `npm run check` | `wrangler types`, then `astro check` |
| `npm run check:bundle` | Fails if the dev sign-in made it into the build |

There are no database tests. Every query runs through the end-to-end suite via the pages.

## Deploying

Workers Builds deploys on push to `main` (root directory `admin`, deploy command `npm run db:migrate && npx wrangler deploy`). From a laptop, after `npx wrangler login`: `npm run deploy`. A schema change is a new numbered file in `migrations/`; `db:migrate` applies only the ones that haven't run yet.

Recovery: `npx wrangler d1 time-travel restore withchris-admin --timestamp=<ISO time>` goes back to any minute in the last 30 days.

## Gotchas

- **The adapter adds KV and Images bindings by default.** `session: false` and `imageService: 'passthrough'` in `astro.config.mjs` turn them off.
- **`Referrer-Policy: no-referrer` breaks the Origin check.** Chrome then sends `Origin: null` on our own form posts. Use `same-origin`.
- **The build copies `admin/.dev.vars` into `dist/server/`**, and `wrangler dev` or `astro preview` on the build reads it from there. It's never deployed. `check:bundle` skips it, and the e2e server deletes it and passes its own `--var`s.
- **The e2e suite has its own local D1** in `.wrangler/e2e`. `scripts/e2e-server.sh` resets it, migrates it and serves the build with the same `--persist-to`, so the dev database is never touched. The reset is in that script because Playwright starts web servers before its global setup.
- **`astro dev` needs the site's packages installed at the repo root.** The admin shares `src/styles/global.css`, so Vite reads the root `tsconfig.json`, which extends `astro/tsconfigs/strict`. Builds, checks and tests don't need them.
- **D1 counts cascaded deletes in `meta.changes`.** Deleting a student with three lessons reports 4.
- **Error messages sit outside `<label>`**, linked by `aria-describedby`, so they don't become part of the field's name.
