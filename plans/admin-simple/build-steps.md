# Build steps

For the implementing session. Work in the `admin-simple` worktree (`.claude/worktrees/admin-simple`, branch `admin-simple` off `main`). Read `README.md`, `app.md`, `access.md` and `deploy.md` first; they're short. The budgets in `README.md` are hard limits. If one can't be met, stop and say why.

The `admin` branch (PR #11, tip `b9760dc`) is the source for most files. Take a file with `git checkout admin -- <path>` from the worktree root, then edit it. Don't merge the branch and don't take anything not listed below.

Commit after each step with a short message. Run the relevant checks before each commit. Don't push or open a pull request until the last step.

## 1. Scaffold `admin/` from PR #11

Take these files unchanged:

```
admin/.npmrc
admin/astro.config.mjs
admin/src/lib/access.ts
admin/src/lib/csv.ts
admin/src/lib/forms.ts
admin/src/lib/money.ts
admin/src/lib/taxyear.ts
admin/src/lib/validate.ts
admin/src/components/Field.astro
admin/src/components/LessonForm.astro
admin/src/components/LessonTable.astro
admin/src/components/StudentForm.astro
admin/src/layouts/Admin.astro
admin/src/styles/admin.css
admin/tests/unit/access.test.ts
admin/tests/unit/csv.test.ts
admin/tests/unit/forms.test.ts
admin/tests/unit/money.test.ts
admin/tests/unit/taxyear.test.ts
admin/tests/unit/validate.test.ts
admin/tests/e2e/fake-access.mjs
```

Take these and edit them as the later steps say:

```
admin/package.json            drop postgres and jsonc-parser; add @types/node; scripts per step 6
admin/.gitignore              add worker-configuration.d.ts and .dev.vars
admin/tsconfig.json           unchanged content, but confirm it includes tests
admin/src/env.d.ts            Locals becomes { email, today, db: D1Database }
admin/src/cloudflare-env.d.ts DEV_STAFF_EMAIL becomes DEV_EMAIL
admin/src/middleware.ts       step 3
admin/src/lib/guard.ts        step 3
admin/src/lib/security.ts     unchanged, but re-read it
admin/src/lib/http.ts         remove need(); fix safeBack (app.md fix 8)
admin/src/pages/**            step 4
admin/tests/unit/guard.test.ts, http.test.ts, security.test.ts   step 5
admin/tests/e2e/admin.spec.ts, global-setup.ts   step 5
admin/playwright.config.ts, admin/scripts/e2e-server.sh          step 5
admin/vitest.config.ts        drop the db project
```

Don't take: `admin/src/lib/db.ts`, `admin/src/lib/repo.ts` (rewritten in step 2), `admin/src/lib/permissions.ts`, `admin/scripts/sync-wrangler.mjs`, `admin/tests/unit/permissions.test.ts`, `admin/tests/unit/sync-wrangler.test.ts`, `admin/tests/db/**`, `admin/worker-configuration.d.ts`, `admin/wrangler.jsonc`, `admin/README.md`, anything under `infra/`, `supabase/` or `.github/` on that branch.

Write `admin/wrangler.jsonc` exactly as shown in `deploy.md`, with the D1 `database_id` left empty until Chris creates the database. Write `admin/migrations/0001_init.sql` from `app.md`.

Then `npm install` in `admin/`, `npx wrangler d1 migrations apply withchris-admin --local`, and confirm `npm run types` generates `worker-configuration.d.ts` with `DB: D1Database` and the three vars.

**Done when:** `admin/` installs, the migration applies locally, and the generated types mention `DB`.

## 2. The data layer

Write `admin/src/lib/repo.ts` for D1 following `app.md`. Same exported names, parameters and return types as PR #11's version (read it with `git show admin:admin/src/lib/repo.ts`), with `db: D1Database` replacing the transaction. No `db.ts`.

Port each query faithfully. Check especially: `listStudents` ordering and the per-filter where clause; `getStudent` totals; `overview` totals and the two capped lists; `listLessons` ordering per view; `markPaid` returning whether a row changed; `markAllPaid` leaving upcoming lessons; `exportLessons` ordering and date filters, with price formatting moved to JavaScript.

**Done when:** `astro check` reports no errors in `repo.ts` itself (the pages still use the old data layer and will fail until step 4) and the file is under 180 lines.

## 3. The door

`src/lib/guard.ts`: Origin check, then the Access verifier, then `ALLOWED_EMAILS`. Returns `{ ok: true, email }` or `{ ok: false, status: 403, message }`. No database lookup, no 503 path.

`src/middleware.ts`: build the verifier as PR #11 did (cached per config, with the `DEV_EMAIL` branch under `import.meta.env.DEV`); run the guard; on refusal return `errorResponse` with security headers; otherwise set `locals.email`, `locals.today` and `locals.db = env.DB`, run the page, and add the security headers. Wrap the page in try/catch: on an error, `console.error` it and return a 500 through `errorResponse` with headers (app.md fix 3). No `sql.end()`, no `waitUntil`.

**Done when:** the guard's unit tests pass (step 5 lists the cases). The routes can't be served until the pages are ported, so the route check moves to step 4: with empty vars, every route returns 403 with the hardening headers, including `/export.csv` and the `paid` endpoints.

## 4. The pages

Port every file under `src/pages/`. Remove every `need(...)` and `can(...)` call and every permission-conditional in templates and the layout's nav. Replace `locals.db((tx) => fn(tx, ...))` with `fn(locals.db, ...)`. Fold in fixes 4, 5 and 6 from `app.md`. Keep everything else, including the inline scripts, the notices, the 404s for bad ids, the confirm on delete, and the phone-width styles.

**Done when:** `npm run check` and `npm run build` pass, `npm run check:bundle` passes, clicking through every page under `npm run dev` with `DEV_EMAIL` set works against the local D1, and with empty vars every route returns 403 with the hardening headers (step 3's check).

## 5. Tests

Unit: drop the permissions and sync-wrangler tests. Simplify `guard.test.ts` for the new guard (no lookup, allow-list cases: allowed, not allowed, empty list, case-insensitive). Add `safeBack` cases for a tab and a backslash to `http.test.ts`. Everything else unchanged.

End to end, following `app.md`:

- `global-setup.ts`: remove the persisted local state directory and apply the migrations locally. No Postgres, no staff rows.
- `e2e-server.sh`: build, write `dist/server/.dev.vars` with the fake Access settings and `ALLOWED_EMAILS=chris@example.com`, and serve with the same `--persist-to` directory the global setup used. Settle the gotcha at the end of `app.md` before anything else in this step.
- `admin.spec.ts`: replace the "no staff record" test with "not in the allow-list" (use `stranger@example.com`), delete the read-only member test, fix the CSV formula test, add the tax-year boundary test. Keep the rest.

**Done when:** `npm run test:unit` and `npm run test:e2e` pass locally, twice in a row, from a clean `dist/` and a clean persisted state directory.

## 6. Scripts, root config, CI

`admin/package.json` scripts:

```
dev            astro dev
build          astro build
preview        astro preview
types          wrangler types --strict-vars=false
check          wrangler types --strict-vars=false && astro check
check:bundle   astro build && ! grep -rl DEV_EMAIL dist/ && echo "bundle ok: no dev sign-in"
test:unit      vitest run
test:e2e       playwright test
db:migrate     wrangler d1 migrations apply withchris-admin --remote
deploy         npm run db:migrate && astro build && wrangler deploy
```

Root `tsconfig.json`: add `"admin"` to `exclude` (app.md fix 1). Root `.gitignore`: nothing new is needed; check that `admin/.gitignore` covers `node_modules/`, `dist/`, `.astro/`, `.wrangler/`, `.dev.vars*`, `test-results/`, `playwright-report/`, `worker-configuration.d.ts`.

`.github/workflows/admin.yml` as described in `deploy.md`. Under 30 lines, no secrets, no deploy.

**Done when:** in a clean export of the branch (`git archive HEAD | tar -x -C <empty dir>`), both `npm ci && npm run check` at the root and `npm ci && npm run check` in `admin/` pass, with no `node_modules` anywhere else. This is the check PR #11 failed.

## 7. Docs and the old plan

Write `admin/README.md`, under 80 lines: what it is, how a request gets in, local development, tests, deploying, the gotchas worth keeping from PR #11 (the KV and Images bindings, `referrer-policy`, where `astro preview` reads `.dev.vars`, the shared `--persist-to` directory). Link to `plans/admin-simple/`.

`plans/admin-user-account-plan.md` already carries a superseded banner at the top. Leave the rest of it as history.

**Done when:** a new reader can go from clone to a working local admin using only `admin/README.md`.

## 8. The budget check and hand-off

Run, from the worktree root, and paste the output into the pull request description:

```sh
git ls-files admin .github/workflows | grep -v -E 'package-lock.json|worker-configuration.d.ts' | xargs wc -l | tail -1
git ls-files admin/src | xargs wc -l | tail -1
ls admin/src/lib | wc -l
node -e 'const p=require("./admin/package.json");console.log(Object.keys(p.dependencies).length,"runtime",Object.keys(p.devDependencies).length,"dev")'
wc -l admin/migrations/0001_init.sql admin/wrangler.jsonc .github/workflows/admin.yml
```

Then push the branch and open a pull request against `main` titled "Admin on D1 behind Access, kept simple". The description: one paragraph on what it is, the budget output, the test counts, and the dashboard steps from `deploy.md` as a checklist for Chris. Link `plans/admin-simple/README.md`.

**Done when:** CI is green on the pull request.

## Review checklist

For the reviewing session. Read `README.md` first for the budgets, then check each item against the code, not the pull request description. Report what you found with file and line, confirmed or plausible, most severe first.

Budgets and brevity:

- [ ] Every number in the budget table in `README.md` holds, measured with the commands in step 8.
- [ ] Nothing from the "What's dropped" table in `README.md` has crept back in any form: no `infra/`, `supabase/`, staff, permissions, audit, Hyperdrive, Terraform, sync script, staging, deploy workflow, GitHub environments.
- [ ] No secrets: grep the workflow for `secrets.`, grep the repo for tokens, confirm `wrangler.jsonc` holds only non-secret values.
- [ ] No helper with one caller, no option that nothing sets, no file that nothing imports.
- [ ] Every dependency is pinned to an exact version, and `compatibility_date` is set.

Security:

- [ ] With `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` or `ALLOWED_EMAILS` empty, every route refuses with 403, including `/export.csv` and both `paid` endpoints.
- [ ] `access.ts` pins RS256, issuer and audience; takes the email from the verified payload only; catches every error and returns null.
- [ ] The allow-list comparison is lower-case on both sides and refuses an empty list.
- [ ] The Origin check runs before verification on every non-GET route. Nothing mutates on GET.
- [ ] Security headers are on every response path: refusals, 404s, the 500 catch, 303 redirects, the CSV.
- [ ] The 500 path logs and returns a fixed message. No stack or query text reaches the browser.
- [ ] Every SQL value is bound. Grep `repo.ts` for template interpolation inside query strings.
- [ ] No `set:html`. Notices come from the fixed table only.
- [ ] `safeBack` rejects control characters and backslashes, and the unit test proves it.
- [ ] `DEV_EMAIL` is gated on `import.meta.env.DEV` and absent from `dist/`.
- [ ] The fake Access server listens on `127.0.0.1` with a per-run key, and nothing in production config references it.

Correctness:

- [ ] `repo.ts` matches PR #11's behaviour query by query: ordering, caps, totals, tax-year and month ranges, `markAllPaid` ignoring upcoming lessons, `markPaid` reporting no change.
- [ ] Deleting a student deletes their lessons (foreign keys enforced), and the e2e test proves it.
- [ ] The tax-year boundary e2e test puts 5 April and 6 April lessons in different years.
- [ ] The CSV formula test puts the payload in an exported column and asserts the apostrophe.
- [ ] The CSV begins with a byte-order mark and every cell goes through `csvCell`.
- [ ] A posted `student_id` not in the student list returns 422, not 500.
- [ ] Migration and e2e server share one local D1; the suite passes twice in a row from clean.

Hygiene:

- [ ] Root `astro check` and admin `astro check` both pass in a clean export with no other `node_modules` present. Do this yourself with `git archive`; don't trust the description.
- [ ] CI workflow: `pull_request` not `pull_request_target`, `permissions: contents: read`, no secrets, under 30 lines.
- [ ] `admin/README.md` is enough to go from clone to a running local admin. Try it.
- [ ] The pull request description's dashboard checklist matches `deploy.md`.
