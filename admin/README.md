# withchris admin

The private admin at `admin.withchris.uk`: students, lessons and payments. Plan and decisions: [`plans/admin-user-account-plan.md`](../plans/admin-user-account-plan.md). Infrastructure: [`infra/`](../infra/README.md). Database: [`supabase/migrations/`](../supabase/migrations/).

## How a request gets in

1. **Cloudflare Access** in front of the hostname lets through the emails in Terraform's policy.
2. **Token check** (`src/lib/access.ts`): the `Cf-Access-Jwt-Assertion` header must be signed by the team's Access keys, for this app's AUD tag. No config means every request is refused.
3. **Staff lookup** (`app.staff_for_email`): the email must have an active row in `staff`.
4. **Every query** runs in a transaction as `authenticated`, with `{"role":"authenticated","app_role":"staff","staff_id":N}` as `request.jwt.claims` (`src/lib/db.ts`). RLS policies decide what that staff member can see and change. The Worker's own login, `admin_worker`, can do nothing else.

Pages also check permissions, but only to decide what to show. The database is the real lock.

## Permissions

| Permission | Allows |
| --- | --- |
| `*` | Everything |
| `students.read` / `students.write` | Student records |
| `finance.read` / `finance.write` | Lessons, money, CSV export |
| `staff.admin` | Staff records |
| `audit.read` | The audit log |

### Adding a staff member

1. Add their email to `allowed_emails` for the environment in Terraform, and apply.
2. Insert their row, from the Supabase SQL editor (runs as `postgres`):

   ```sql
   insert into staff (email, name, permissions) values ('someone@example.com', 'Someone', '{students.read}');
   ```

Remove someone by setting `active = false` (immediate) and removing them from `allowed_emails`.

## Local development

Needs Node 22+, and Postgres 17 or Docker.

```sh
cd admin
npm install            # .npmrc sets legacy-peer-deps (an npm 11 resolver bug with vitest peers)
```

**A database.** Either `supabase start` from the repo root (Docker), or a throwaway Postgres:

```sh
initdb -D /tmp/pg -U postgres --auth=trust && pg_ctl -D /tmp/pg -o "-p 54339 -k ''" start
npm run test:db        # creates admin_test, applies the Supabase shim and every migration
```

**Run it.** Create `admin/.dev.vars` (git-ignored):

```sh
DEV_STAFF_EMAIL=chris@example.com    # dev-only sign-in; stripped from every build
```

and seed a staff row for that email in `admin_test`, then:

```sh
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://admin_worker:test-worker-password@127.0.0.1:54339/admin_test
npm run dev
```

## Tests

| Command | What | Needs |
| --- | --- | --- |
| `npm run test:unit` | Money, tax years, CSV, validation, Access tokens, the request guard, the wrangler sync script | Nothing |
| `npm run test:db` | Every RLS rule, as anon, the worker, each kind of staff, and an agent; the audit trigger; every query | Postgres on 54339, or `TEST_DB_MODE=supabase` |
| `npm run test:e2e` | The production build behind a fake Access, against the database: sign-in refusals, every page and form, CSV, phone width | As above, plus `npx playwright install chromium` |
| `npm run check` | Types | Nothing |
| `npm run check:bundle` | The dev sign-in isn't in the build | Nothing |

Against a local Supabase (as CI does):

```sh
supabase start
TEST_DB_MODE=supabase TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db
```

## Deploying

GitHub Actions deploys on every merge to `main` that touches the admin (`.github/workflows/admin.yml`):

1. tests
2. staging: `supabase db push`, then deploy
3. production: the same steps, after Chris approves the run in GitHub

The first deploy of each environment is different, and [`infra/README.md`](../infra/README.md) has the order. Each deploy job runs `node scripts/sync-wrangler.mjs --check <env>` first, and refuses to deploy until Terraform's outputs are in `wrangler.jsonc`:

```sh
terraform -chdir=../infra/envs/staging output -json wrangler | node scripts/sync-wrangler.mjs   # then commit
```

Even when deployed without them, the admin refuses every request until `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set.

### Setting the worker's password

After migrations, once per environment, in the Supabase SQL editor:

```sql
alter role admin_worker login password '<generated, from the password manager>';
```

The same password goes to Terraform as `TF_VAR_admin_worker_password`, for the Hyperdrive config. To rotate it, change both and apply.

## Gotchas

- **The adapter adds KV and Images bindings by default.** `session: false` and `imageService: 'passthrough'` turn them off.
- **`Referrer-Policy: no-referrer` breaks the Origin check.** Chrome then sends `Origin: null` on our own form posts. Use `same-origin`.
- **Staging is chosen at build time.** The adapter writes `dist/server/wrangler.json` for one environment, so it's `CLOUDFLARE_ENV=staging astro build`, not `wrangler deploy --env staging`.
- **`astro preview` reads `.dev.vars` from `dist/server/`**, not from `admin/`.
- **Absolutely positioned elements inside a scrolling table** need the table wrapper to be `position: relative`, or they widen the page.
- **Error messages sit outside `<label>`**, linked by `aria-describedby`, so they don't become part of the field's name.
