# Plan: private admin at admin.withchris.uk

A private area for running the tutoring business: students, the lessons taught to them, and who has paid. Chris is the only user for now. Later the same login and database serve staff accounts and the harness (see [`harness-plan.md`](../harness-plan.md)).

**Status (2026-10-10):** revision 2 is **built and tested locally**, but not deployed. The code is in `admin/`, `supabase/migrations/` and `infra/`, with 142 unit and database tests and 15 end-to-end tests passing (see [Build steps](#build-steps)). Deploying needs the bootstrap in [`infra/README.md`](../infra/README.md) and Chris's answers to the open questions.

Two things changed since revision 1:

- **The first build isn't in the repo.** Revision 1 said it was built and tested on an `admin-account-users` branch. That branch doesn't exist locally or on origin, and no checkout has an `admin/` folder. The D1 database `withchris-admin` exists, but the Cloudflare API reports 0 tables. Unless the code turns up, the admin is rebuilt from this plan. The findings from the first build are kept under [Research notes](#research-notes-and-gotchas).
- **The harness changes the platform.** Chris's decision that access control lives in the data layer (row-level security) can't be met on D1. Revision 2 moves the admin to Supabase Postgres, shared with the harness, and brings in Terraform for infrastructure (see [`infra-plan.md`](infra-plan.md)).

**Order (Chris, 2026-10-10): the admin is built first, on its own. The harness comes after.** Nothing here waits on the harness or its spike. The admin defines the shared pieces (the `staff` table, the claim shape, `supabase/migrations/`, `infra/`), and the harness builds on them later. Anything in this plan that only matters once the harness exists is marked *later*.

Decisions marked **(proposed)** need Chris's OK. Everything else carries over from revision 1.

## Goals

- One login, Chris's own, and nobody else can get in. The same login later extends to staff accounts with limited permissions.
- Keep student and parent details, lesson notes and payments in one place, instead of in Gmail and memory.
- See at a glance what's owed and what's been earned, and export a year's lessons for the tax return.
- Change nothing about the public site, `withchris.uk`: it stays static, fast and free.
- Share one database with the harness, so the Cathys and the admin see the same students, with access enforced by the database rather than by app code.

Out of scope for the first version: logins for students or parents, online payments, calendar sync, automatic emails, and anything the harness does. See [Later](#later).

## Decisions

### A subdomain and a separate Worker

Unchanged. The admin lives at `admin.withchris.uk` as its own Cloudflare Worker, built from an `admin/` folder in this repo.

- The public site keeps no server code. Nothing in the admin can break or slow it down.
- The two deploy separately, so a blog post doesn't redeploy the admin.
- Being in the same repo lets the admin reuse the site's colours and fonts from `src/styles/global.css`.

### Login: Cloudflare Access, mapped to a staff record

Cloudflare Access sits in front of `admin.withchris.uk`. It sends a one-time code by email, or can use Google sign-in. It's free for up to 50 users.

**Second lock (unchanged).** The admin checks the signed token Access adds to each request (`Cf-Access-Jwt-Assertion`): signed by the account's Access keys, for this app's AUD tag, from the right team domain. If any of these is missing, every request is refused, so a misconfigured Access policy fails closed.

**New: staff mapping (proposed).** After the token check, the admin looks up the token's email in the `staff` table. No row, or `active = false`, means 403. Today the table has one row, Chris, with `permissions = {'*'}`. A later staff account gets a row with specific permissions (for example `students.read`, `finance.read`). Access decides *who can reach the hostname*; `staff` decides *what they can do*. Two places to remove someone is acceptable, and Terraform manages the Access side (see [`infra-plan.md`](infra-plan.md)).

### Database: Supabase Postgres, shared with the harness (proposed)

Revision 1 chose D1 and rejected Supabase as a second provider. That still holds for a one-user admin, but it isn't a one-user system any more:

- Chris decided that access control is enforced in the data layer: row-level security, scoped storage, a service role. D1 is SQLite and has none of that.
- The harness needs the same `students` the admin manages, and needs Cathys locked to their own portfolio by the database (harness H2).
- The admin isn't deployed and holds no data, so moving now costs nothing. Moving after launch means a data migration and a second round of testing.

**Proposal:** one Supabase project in London (`eu-west-2`), Pro plan, shared by the admin and the harness. A second project for staging (see [Environments](#environments)). The admin reaches Postgres through Cloudflare Hyperdrive.

**How the admin runs queries under RLS.** The admin never uses the service role. It connects through Hyperdrive as a dedicated login role, `admin_worker`, which has no table rights of its own and no `BYPASSRLS`. Every request runs in one transaction that starts:

```sql
set local role authenticated;
select set_config('request.jwt.claims', $1, true);  -- {"role":"authenticated","app_role":"staff","staff_id":N}
```

RLS policies then read `auth.jwt()` the same way they would for a Supabase Auth user or a harness-minted Cathy token. The claims come from the verified Access token plus the `staff` row, never from anything the browser sends. `set local` lasts only as long as the transaction, so it's safe with Hyperdrive's connection pooling.

This needs no JWT signing secret in the admin Worker. The claim shape is `{"role":"authenticated","app_role":"staff","staff_id":N}`. `role` has to be the Postgres role, because that's what Supabase's API reads from a token, so ours is `app_role`. Permissions aren't in the claims: policies read them from `staff` on every check, so a change takes effect immediately. *Later*, the harness mints Cathy tokens as `{"role":"authenticated","app_role":"agent","agent_id":N}`, which the admin's policies already refuse.

**Fallback if Chris says no:** keep D1, rebuild exactly as revision 1, and accept that the harness either uses its own database or a single data-access Worker (harness H2 fallback). Moving later would be a one-off export of a few hundred rows.

### Framework: Astro with the Cloudflare adapter

Unchanged. Same components, styles and conventions as the public site. Every page rendered per request, forms post back to their own page, almost no client-side JavaScript. Database access is `postgres` (postgres.js) through the Hyperdrive binding, with bound parameters only.

### Infrastructure: Terraform for the account, wrangler for the code (proposed)

Revision 1 rejected Terraform for six dashboard settings and listed when to revisit: more domains and rules, staging copies, or another person helping run the account. The harness brings the first two:

- More hostnames (`harness.withchris.uk`), more Access apps, policies and service tokens.
- Hyperdrive, R2, Containers and a Supabase project, each in staging and production.

So the dashboard checklist from revision 1 becomes Terraform. The split:

| What | Managed by |
| --- | --- |
| Access apps, policies, service tokens; DNS; custom domains; Hyperdrive configs; R2 buckets; the Supabase projects and their settings | Terraform, in `infra/` |
| Worker code, its bindings and deploys | wrangler (`admin/wrangler.jsonc`), unchanged |
| Tables, RLS policies, roles, storage policies | SQL migrations in `supabase/migrations/` |

Terraform outputs the Access team domain, AUD tag and Hyperdrive id, and `admin/scripts/sync-wrangler.mjs` writes them into `wrangler.jsonc`, so nobody copies them by hand. The details, including the state file, the API token and the import of what exists today, are in [`infra-plan.md`](infra-plan.md).

### Plan tier: Workers Paid (proposed)

Revision 1 aimed to stay on Cloudflare's free plan. The admin alone still would, but the harness needs Containers, which require Workers Paid ($5 a month). It's one account, so the admin moves with it. Supabase Pro is $25 a month per project.

### Not off-the-shelf tutoring software

Unchanged. TutorBird or Teachworks (about £10–20 a month) or a Google Sheet would cover the admin alone. They can't share a database with the harness, which makes building our own the clearer choice now.

## Environments

| | Staging | Production |
| --- | --- | --- |
| Hostname | `admin-staging.withchris.uk` | `admin.withchris.uk` |
| Access | Chris's email; a separate Access app | Chris's email |
| Database | Supabase project `withchris-staging` | Supabase project `withchris-prod` |
| Data | Made-up students only | Real data |
| Deploy | GitHub Actions, on every merge to `main` that touches the admin | GitHub Actions, right after staging, once Chris approves in GitHub |

Staging exists so migrations and RLS policies are tested without touching real children's data. *Later*, the harness uses the same staging project. If $25 a month for a second project is too much, the alternative is Supabase branching on the prod project (charged per hour while a branch is up). See the open questions.

## Data model

Postgres, in the `public` schema. Money is stored in pence (`integer`) to avoid rounding errors. Every table has `id bigint generated always as identity`, `created_at` and `updated_at`.

**staff** (new, shared with the harness)

| Field | Notes |
| --- | --- |
| `email` | Unique; matched against the Access token's email, case-insensitive |
| `name` | |
| `permissions` | `text[]`; `{'*'}` for Chris |
| `active` | `false` locks the account without deleting it |

**students**

| Field | Notes |
| --- | --- |
| `name` | Required |
| `level`, `exam_board` | GCSE / A Level / A Level + Further / Admissions test / Other; AQA, Edexcel, OCR, OCR MEI, MAT… |
| `student_email` | Optional |
| `parent_name`, `parent_email`, `parent_phone` | |
| `rate_pence` | Usual price per lesson, used when logging a lesson |
| `status` | `active`, `paused` or `finished` (a Postgres enum or check) |
| `notes` | Goals, target grade, what they find hard. Staff only. |

The harness wants extra columns on `students` (`phone_e164`, `consent_ai`, `consent_whatsapp`, `login_email`) and separate `guardians` tables. The admin owns `students`; the harness proposes column changes through the admin inbox, and the admin writes the migration. Until the harness lands guardians, parent details stay as columns here.

**lessons**

| Field | Notes |
| --- | --- |
| `student_id` | `on delete cascade`: deleting a student deletes their lessons |
| `date`, `time` | `date` and an optional `time` |
| `minutes` | Default 60 |
| `price_pence` | Defaults to the student's rate, can be changed for one lesson |
| `covered`, `homework`, `notes` | Notes are private |
| `paid_on` | Date paid, or null while unpaid |

Lessons dated in the future count as upcoming, not owed.

**audit_log** (new)

`at`, `staff_id`, `action` (`insert`, `update`, `delete`), `table_name`, `row_id`, `changes jsonb`. Written by a trigger on `students`, `lessons` and `staff`, not by app code, so nothing can skip it. Needed for safeguarding and UK GDPR (harness R7) once more than one person or agent can change records. Staff can read it; nobody can update or delete it.

### RLS policies (first version)

RLS is enabled on every table, with no policy granting anything to `anon`.

| Table | Read | Write |
| --- | --- | --- |
| `staff` | Staff: their own row; `*` or `staff.admin`: all | `*` or `staff.admin` |
| `students` | `*` or `students.read` | `*` or `students.write` |
| `lessons` | `*` or `finance.read` | `*` or `finance.write` |
| `audit_log` | `*` or `audit.read` | Trigger only |

*Later*, the harness adds agent and student policies (a Cathy reading her portfolio's students) on top of these.

Each policy is tested: a pgTAP or plain SQL test runs every table and operation as `anon`, as a staff member with no permissions, as Chris, and as an `agent` claim, and checks the result. The `agent` case must see nothing until the harness adds its policies. These run in CI against a local Supabase (`supabase start`).

## Pages

Unchanged from revision 1.

| Page | What it shows |
| --- | --- |
| Overview `/` | Earned this month, owed, earned this UK tax year; upcoming lessons; unpaid lessons with a "Mark paid" button |
| Students `/students` | Filter by active, paused, finished or all; level, parent, last lesson, amount owed |
| Student `/students/:id` | Contact details, notes, totals, every lesson, "Mark all paid" |
| Add / edit student | Includes delete, which warns that it removes their lessons too |
| Lessons `/lessons` | Taught, upcoming or unpaid; CSV links for the last three tax years |
| Log / edit lesson | Picking a student fills in their rate |
| Export `/export.csv` | Lessons between two dates, or everything, as CSV |

The tax year runs from 6 April to 5 April, matching HMRC Self Assessment. Pages a staff member lacks permission for return 403, and the nav hides them.

## Security

- **Access** in front of the whole hostname. Terraform manages the app and the policy.
- **Token check** on every request, failing closed.
- **Staff lookup** after the token check, failing closed.
- **RLS** on every table. The admin's database role can't bypass it; the service role key is never given to the admin Worker.
- **No `workers.dev` or preview URLs** for the admin (`workers_dev: false`, `preview_urls: false`), so the custom domain behind Access is the only way in. Staging gets its own hostname behind its own Access app instead.
- **Form posts** only accepted when `Origin` matches the admin's own address.
- **Response headers:** `no-store`, `DENY` framing, `same-origin` referrer, `noindex`.
- **CSV export** prefixes cells starting with `=`, `+`, `-` or `@`.
- **SQL:** bound parameters only.
- **Supabase:** the Data API (PostgREST) isn't used by the admin. Terraform restricts its exposed schemas, and RLS covers it regardless.

## Research notes and gotchas

From building and testing the first version (still valid):

- **The adapter creates a KV namespace by default.** `@astrojs/cloudflare` turns on Astro sessions backed by KV. Access handles login, so the config sets `session: false` and no KV is created.
- **It also adds a Cloudflare Images binding by default.** `imageService: 'passthrough'` avoids it.
- **`Referrer-Policy: no-referrer` breaks the Origin check.** Chrome then sends `Origin: null` on form posts. Use `same-origin`.
- **Generated Workers types clash with browser DOM types** in client scripts during `astro check`. Keep the one client script (rate fill-in) as inline plain JS.
- **Local preview reads `.dev.vars` from `dist/server/`**, not from `admin/`.

No longer relevant if Postgres is accepted: the hand-added `d1_migrations` row.

To check during the rebuild:

- Hyperdrive with postgres.js on Workers: `prepare: false` may be needed for pooled connections; local dev uses `localConnectionString` pointing at `supabase start`.
- That `set local role` and `set_config(..., true)` behave as expected through Hyperdrive's pooler (one test that runs two requests with different claims back to back).
- Supabase's newer API keys and JWT signing keys: confirm `auth.jwt()` reads `request.jwt.claims` set this way on the current Postgres version.

## Build steps

Built test-first. Each layer's tests were written before its code.

- [x] **Migrations** (`supabase/migrations/20261010120000_admin_core.sql`):
  - the `admin_worker` role, and `staff`, `students`, `lessons`, `audit_log`
  - the RLS policies, the audit and `updated_at` triggers, and `app.staff_for_email`
  - also checked that it applies as a non-superuser, like Supabase's `postgres` role
- [x] **Policy tests** (`admin/tests/db/rls.test.ts`, 21 tests):
  - run as anon, as the bare worker login, as Chris, as each limited permission, as inactive staff, as an agent, and with forged claims
  - check the audit trail
  - check that no claims leak between transactions on one connection
- [x] **Queries** (`admin/src/lib/repo.ts`, 11 tests under RLS).
- [x] **The app** (`admin/`):
  - the Access token check, the staff lookup and the per-request transaction
  - every page from [Pages](#pages)
  - CSV export, and mark paid / mark all paid
- [x] **Unit tests** for money, the UK tax year, CSV, validation, the Access verifier, the request guard, the HTTP helpers and the wrangler sync.
- [x] **End-to-end** (`admin/tests/e2e/`, Playwright against the production build, a fake Access, and the database):
  - refusals: no token, wrong app, unknown email, cross-site post; plus the security headers
  - add a student, with validation, and the rate filling in
  - past, upcoming and discounted lessons; overview totals
  - mark paid and mark all paid; editing; CSV quoting and formula protection
  - delete with cascade, 404s, phone width
  - a `students.read`-only member sees no money
- [x] **Infra code** (`infra/`): account, staging and prod; `terraform validate` passes against the real provider schemas.
- [x] **CI** (`.github/workflows/admin.yml`):
  - type check, the bundle check, and unit, database and end-to-end tests against `supabase start`
  - `terraform fmt` and `validate`
- [ ] **Run the database tests against a real local Supabase** (`supabase start`; CI does this). Locally, Docker wasn't running, so they ran against plain Postgres 17 with a shim that copies Supabase's roles, default grants and `auth.jwt()`.
- [ ] **Bootstrap and staging:** the order is in [`infra/README.md`](../infra/README.md). Needs Chris: Workers Paid, the Supabase org, API tokens, passwords.
- [ ] **Check the Hyperdrive host:** Supabase direct (IPv6) or the Supavisor session pooler.
- [ ] **Production:** apply, migrate, deploy, add Chris's staff row, smoke test with his login.
- [ ] **Remove D1:** delete `withchris-admin` (no tables).

### Changes from the plan made while building

- **Deploys run from GitHub Actions, not Workers Builds** (Chris, 2026-10-10). This applies to the public site as well. Pull requests get a preview of the site. A merge deploys the admin to staging, then to production after approval. Migrations run in the same job, just before the deploy.

- **Claims use `app_role`, not `role`.** Supabase uses `role` in a token as the Postgres role to switch to.
- **Permissions are read from `staff` on every check, not carried in the claims,** so revoking one takes effect on the next query.
- **The overview shows money taught and money received separately** for the month and the tax year. Self Assessment's default cash basis counts income when it's received.
- **Staging is chosen at build time** (`CLOUDFLARE_ENV=staging astro build`). The Astro adapter writes the deploy config for one environment.
- **Dev-only sign-in** (`DEV_STAFF_EMAIL`, only under `astro dev`). A browser can't add the Access header. CI checks it's absent from the build.
- **Private lesson notes are left out of the CSV export.**
- **`admin/.npmrc` sets `legacy-peer-deps`.** npm 11 crashes resolving vitest's optional peers.

## Coordination

The admin goes first, so it sets up the shared foundations: `infra/`, `supabase/migrations/`, the `staff` table and the claim shape. The harness picks them up when its work starts. Until then, nothing the admin does needs the harness's agreement. Questions for the harness are left in its inbox so they're waiting when it begins.

Once both are active:

- The admin owns `admin/`, and the `staff`, `students`, `lessons` and `audit_log` tables and their migrations.
- The harness owns `harness/`, the `harness` schema, and the agent, worksheet, conversation and staff-room tables.
- `supabase/migrations/` is one folder, with one migration history. Each workstream writes migrations only for tables it owns. Changes to the other's tables go through its inbox.
- Inboxes: `plans/inbox/admin.md` and `plans/inbox/harness.md`, append-only, as described in the harness plan.
- Plans and inboxes sync through `main`, not the stale `plans` branch (proposed to the harness in its inbox).

## Data protection

The admin stores personal details about children and their parents, so UK GDPR applies.

- Keep only what's needed.
- Delete students who've finished and whose records aren't needed for tax.
- Access is limited to named staff, each with a role, and every change is in the audit log.
- Supabase in London keeps the data in the UK. Sign Supabase's DPA.
- Check on the ICO website whether the yearly data protection fee is due. Small businesses that keep client records usually need to pay it.
- The harness's AI use of this data waits for harness R7 (consent, retention, the ICO children's code).

## Later

In rough order of usefulness:

1. **Enquiries from `/learn`.** A contact form on the public site that saves to the admin, through a small public endpoint on the admin Worker with spam protection (Cloudflare Turnstile).
2. **Calendar feed.** An `.ics` URL of upcoming lessons to subscribe to from Google Calendar.
3. **Monthly statements.** A per-student summary of lessons and amount due, ready to email to a parent.
4. **Payments.** Stripe payment links on statements, with paid status updated automatically.
5. **Reminder emails.** Day-before lesson reminders to parents.
6. **Harness views.** Which Cathy has which student, and their spend. Built once the harness tables exist.

## Open questions for Chris

1. **Missing code:** does the first build exist anywhere (another machine, an unpushed worktree)? If not, it's a rebuild.
2. **Database:** confirm Supabase Postgres in London, shared with the harness, in place of D1?
3. **Staging:** a second Supabase project ($25 a month), or branching on the prod project?
4. **Plan tier:** OK to move the Cloudflare account to Workers Paid ($5 a month)?
5. **Supabase org:** a new org just for withchris, separate from the projects behind the existing `supabase-prod` / `supabase-staging` MCP servers? (Recommended: yes, so permissions and billing don't mix.)
7. Carried over: login method (one-time PIN only, or Google too); how long to keep finished students (tax records about 5 years after the filing deadline); which [Later](#later) item comes first.
