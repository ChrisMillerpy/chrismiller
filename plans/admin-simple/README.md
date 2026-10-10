# Plan: the admin, kept simple

A private page at `admin.withchris.uk` for running the tutoring business: students, the lessons taught to them, and who has paid. One user, Chris. Built to be cool, fun to work on, and boring to run.

**Status (2026-10-10):** planned, not built. This supersedes revision 2 of [`admin-user-account-plan.md`](../admin-user-account-plan.md) and its pull request, [#11](https://github.com/ChrisMillerpy/chrismiller/pull/11). Revision 1 of that plan had the right shape; revision 2 grew to serve a harness and staff accounts that don't exist. This plan goes back to the revision 1 shape, keeps the good code from PR #11, and drops the rest.

| File | What it covers |
| --- | --- |
| `README.md` | Why, the brevity requirement, decisions, what's dropped and why |
| [`app.md`](app.md) | Pages, the SQLite schema, the data layer on D1, tests |
| [`access.md`](access.md) | Login and security |
| [`deploy.md`](deploy.md) | Account, D1, Workers Builds, local dev, CI, teardown of PR #11's infrastructure |
| [`build-steps.md`](build-steps.md) | Ordered steps for the implementer, acceptance criteria, and the reviewer's checklist |

**Who does what.** An implementing session (Opus 5.5) follows `build-steps.md` in the `admin-simple` worktree. A reviewing session (Fable 5.1) checks the result against the checklist at the end of `build-steps.md` and the budgets below. Neither should need to read PR #11's plan documents; everything needed is here.

## Goals

- One login, Chris's own, and nobody else can get in.
- Students, parents, lesson notes and payments in one place instead of Gmail and memory.
- See what's owed and what's been earned, and export a tax year's lessons as CSV.
- Change nothing about the public site. It stays static and free.
- Cost nothing to run, need nothing to keep running, and stay fun to add to.

Out of scope: logins for students or parents, online payments, calendar sync, automatic emails, staff accounts, and anything for the harness. See [Later](#later).

## The brevity requirement

Every piece of this system must justify itself with a user who exists today (Chris) or a concrete failure it prevents. "Later we might" is not a justification. The implementer and reviewer hold the build to these budgets:

| Budget | Limit |
| --- | --- |
| Vendors | Cloudflare. GitHub holds the code. Nothing else. |
| Secrets in GitHub, in the repo, or on the laptop for this project | 0 |
| Monthly cost | £0 |
| Environments | 1 (production) plus local dev |
| Runtime dependencies | `astro`, `@astrojs/cloudflare`, `jose`, and the three `@fontsource-variable` packages the site already uses |
| Dev dependencies | at most 7 |
| Hand-written lines in `admin/`, including tests and config | at most 2,200 |
| `admin/src` | at most 1,300 lines |
| The migration | at most 60 lines |
| `admin/wrangler.jsonc` | at most 30 lines |
| CI workflow | at most 30 lines, no secrets, no deploy job |
| Files in `admin/src/lib` | at most 10 |

Hand-written excludes `package-lock.json` and the generated `worker-configuration.d.ts`.

Rules that follow from the budgets:

- No abstraction with one caller. No helper "for when we add X".
- No configuration for a case that doesn't exist. One environment, one database, one Worker.
- No environment that isn't used every week. Staging is replaced by local dev and D1's point-in-time restore.
- No permission system for one person. The Access allow-list is the authorisation.
- No audit log for a person auditing himself. `updated_at` is enough.
- No infrastructure code for settings that are set once. The dashboard is fine for six settings.
- Nothing that needs a secret. Access verifies with public keys and D1 is a binding.
- Pin every dependency version exactly, and the `compatibility_date`. Stable beats fresh.

If a budget can't be met, the implementer stops and says why rather than quietly exceeding it.

## Decisions

### Cloudflare Workers, D1 and Access. Nothing else.

| Need | Choice | What it replaces from PR #11 |
| --- | --- | --- |
| Hosting | One Worker, `withchris-admin`, Astro server-rendered | Same |
| Database | D1 (SQLite in the same account) | Supabase Postgres, Hyperdrive, a password set in two places |
| Login | Cloudflare Access, one-time PIN, email allow-list | Same, plus a `staff` table and six permission strings |
| Authorisation | Access's allow-list, re-checked in the app from an `ALLOWED_EMAILS` variable | Row-level security, 13 policies, per-transaction claims |
| History and recovery | D1 Time Travel, 30 days of point-in-time restore, free | An audit log trigger and a staging environment |
| Infrastructure | About six dashboard settings, listed in `deploy.md` | Terraform, three environments, state in R2, a Keychain script |
| Deploys | Workers Builds on push to `main`, or `npm run deploy` from the laptop | GitHub Actions with four environments, secrets, and an approval gate |
| Local dev and tests | `wrangler` gives a local SQLite D1 automatically | Postgres 17 or Docker plus the Supabase CLI and a compatibility shim |

### Why D1 and not Postgres

D1 is a binding on the Worker: no connection string, no pooler, no password, no second vendor, no free-tier project that pauses after a quiet week. It has point-in-time restore built in. Local dev and tests get a local SQLite with no setup. The admin holds a few hundred rows; D1's free tier is thousands of times bigger than that.

The only argument for Postgres was sharing a database with the harness under row-level security. The harness isn't started. If it ever needs the students, moving a few hundred rows is a one-off export, and the policies will be designed against a real harness instead of one on paper.

### Why Access alone is enough authorisation

Access decides who reaches the hostname. The app checks the signed token Access attaches to every request, and then checks that the token's email is on its own short allow-list. That's two places to add a person and both are one line. If a second person ever needs less than full access, that's the day to design permissions, against a real need.

### Why no staging

Staging existed to test migrations and policies away from real data. There are no policies now, migrations are a few lines of SQLite, and every change is tried locally first against a local D1 with the full end-to-end suite. If a deploy goes wrong, Time Travel restores the database to any minute in the last 30 days.

### Why no Terraform

Revision 1 said it: six one-time settings don't justify a state file, a wide-permission API token and provider upgrades. The Cloudflare provider churns between minor versions. The settings are listed in `deploy.md` and take about fifteen minutes once.

### Why Workers Builds and not GitHub Actions for deploys

Workers Builds deploys on push with no secrets in GitHub. The public site already uses it. GitHub Actions stays for tests only, with no secrets and no deploy jobs, so there's nothing to configure or approve.

## What's kept from PR #11

The application code is good and most of it ports unchanged. `build-steps.md` lists exactly which files to take from the `admin` branch and which to rewrite. In short: every page, component, layout and style; validation, money, tax year, CSV and HTTP helpers; the Access token check, the Origin check and the security headers; the unit tests; and the end-to-end suite with its fake Access server.

Review findings from PR #11 that still apply are folded in. They're listed in `app.md` under "Fixes from the review".

## What's dropped, and why

| Dropped | Why |
| --- | --- |
| `infra/` (Terraform, three environments, modules, R2 state, `creds.sh`) | Six settings, set once, in the dashboard |
| `supabase/` (CLI config, the Postgres migration) | No Postgres |
| Row-level security, `app.*` helper functions, per-transaction claims | One user |
| `staff` table, permissions, `permissions.ts`, `need()` and `can()` | One user |
| `audit_log` and its trigger | `updated_at` plus Time Travel |
| Hyperdrive and the `admin_worker` role | No Postgres |
| Staging Supabase project, Worker, Access app and Hyperdrive config | No staging |
| `scripts/sync-wrangler.mjs` and its test | No Terraform outputs to sync |
| `tests/db/` (32 tests, the Supabase shim, global setup) | They tested the policies. Queries are covered end to end |
| `.github/workflows/admin.yml` deploy jobs, GitHub environments, approval gate | Workers Builds |
| `.github/workflows/site.yml` | The site keeps Workers Builds |
| `plans/infra-plan.md`, `plans/inbox/` | No infrastructure plan; harness coordination waits for a harness |
| The Workers Paid plan | Nothing here needs it |

## Data protection

The admin stores personal details about children and their parents, so UK GDPR applies.

- Keep only what's needed. Delete finished students whose records aren't needed for tax.
- Access is one named person. Every request is checked twice.
- D1 stores the data in Cloudflare's western Europe location. Time Travel keeps 30 days of history.
- Check on the ICO website whether the yearly data protection fee is due.

## Later

Things that become easy once the infrastructure is this small. In rough order of fun:

1. **Calendar feed.** An `.ics` route of upcoming lessons to subscribe to from Google Calendar.
2. **Monthly statements.** A per-student page of lessons and amount due, ready to send to a parent.
3. **Enquiries from `/learn`.** A contact form on the public site that saves to the admin, with Turnstile.
4. **Payment links.** Stripe links on statements that mark lessons paid.
5. **A second person.** Add their email to Access and to `ALLOWED_EMAILS`. Design permissions only if they need less than everything.
6. **The harness.** Give it a read endpoint on this Worker behind an Access service token, or export the rows. Decide when it exists.
