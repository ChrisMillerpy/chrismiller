# The app

Astro with the Cloudflare adapter, every page rendered per request, forms posting back to their own page, almost no client-side JavaScript. Same framework and conventions as the public site, sharing its `src/styles/global.css`. All of this is unchanged from PR #11. What changes is the data layer, which moves from Postgres to D1, and the removal of permissions.

## Pages

Unchanged from PR #11. Every signed-in request can do everything.

| Route | What it does |
| --- | --- |
| `/` | Four cards: taught this month, owed, taught this tax year, received this tax year. Next 10 upcoming lessons. Up to 100 unpaid past lessons with Mark paid and Edit. |
| `/students` | Filter tabs Active (default), Paused, Finished, All. Name, level, parent, last lesson, owed. |
| `/students/new` | Add a student. |
| `/students/:id` | Contact details with mailto links, notes, lessons taught, paid and owed, every lesson, Mark all paid, Log a lesson with the student preselected, Edit. |
| `/students/:id/edit` | Edit every field. Delete with a browser confirm that says lessons go too. |
| `POST /students/:id/paid` | Mark every past unpaid lesson paid today. |
| `/lessons` | Tabs Taught, Upcoming, Unpaid. CSV links for the current and two previous tax years, plus everything, plus a from/to form. |
| `/lessons/new` | Log a lesson. Picking a student fills in their rate. `?student=` preselects. |
| `/lessons/:id/edit` | Edit every field. Delete with confirm. |
| `POST /lessons/:id/paid` | Mark one lesson paid today, then back to where the button was. |
| `/export.csv` | `?tax_year=YYYY`, or `?from&to`, or everything. Columns: date, time, student, level, minutes, price, paid_on, covered, homework. Private notes are left out. |

The tax year runs 6 April to 5 April. "Today" is computed in Europe/London. Lessons dated after today are upcoming, not owed.

## Data model

Two tables. Money is integer pence. Dates are `YYYY-MM-DD` text and compare correctly as strings. Times are `HH:MM` text.

`admin/migrations/0001_init.sql`:

```sql
create table students (
  id integer primary key autoincrement,
  name text not null check (length(trim(name)) between 1 and 200),
  level text check (level in ('GCSE', 'A Level', 'A Level + Further', 'Admissions test', 'Other')),
  exam_board text check (length(exam_board) <= 50),
  student_email text check (length(student_email) <= 254),
  parent_name text check (length(parent_name) <= 200),
  parent_email text check (length(parent_email) <= 254),
  parent_phone text check (length(parent_phone) <= 40),
  rate_pence integer not null default 0 check (rate_pence >= 0),
  status text not null default 'active' check (status in ('active', 'paused', 'finished')),
  notes text check (length(notes) <= 10000),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table lessons (
  id integer primary key autoincrement,
  student_id integer not null references students (id) on delete cascade,
  date text not null check (date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  time text check (time glob '[0-2][0-9]:[0-5][0-9]'),
  minutes integer not null default 60 check (minutes between 5 and 600),
  price_pence integer not null check (price_pence >= 0),
  covered text check (length(covered) <= 10000),
  homework text check (length(homework) <= 10000),
  notes text check (length(notes) <= 10000),
  paid_on text check (paid_on is null or paid_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index lessons_student_date on lessons (student_id, date desc);
create index lessons_date on lessons (date);
```

Notes:

- D1 enforces foreign keys by default, so the cascade works. The implementer verifies this with the end-to-end delete test rather than trusting the sentence.
- `updated_at` is set in each `update` statement. No trigger.
- The check constraints match `validate.ts`, which stays the first line of defence. The database is the second.
- Any later migration is a new numbered file in `admin/migrations/`. Wrangler tracks which have been applied.

## The data layer

`src/lib/db.ts` from PR #11 goes. `src/lib/repo.ts` keeps its exported function names, parameters and return types, so the pages change as little as possible, but its body is rewritten for D1.

- Every function takes `db: D1Database` as its first argument instead of a transaction.
- Queries are `db.prepare(sql).bind(...)` with `?1`-style placeholders. Values are bound, never interpolated. `undefined` is never bound; use `null`.
- Reads use `.all<Row>()` for lists and `.first<Row>()` for one row.
- Writes use `.run()` and read `meta.changes` or `meta.last_row_id`.
- Inserts and updates list their columns explicitly. The dynamic column helper from postgres.js has no equivalent and isn't missed; the input types have fixed keys.
- Postgres idioms translate as follows. `sum(x) filter (where c)` becomes `sum(case when c then x end)`. `::int` casts go. `to_char(time, 'HH24:MI')` goes, since time is already text. Price formatting for the CSV moves to JavaScript using `money.ts`. Enum casts go.
- No transactions. Nothing in the app needs more than one statement to be atomic. If that changes, `db.batch([...])` is atomic.
- The middleware sets `locals.db = env.DB`. `App.Locals` becomes `{ email: string; today: string; db: D1Database }`.

Keep the queries' behaviour exactly as PR #11 had it, including the ordering rules, the 500-row cap on `/lessons`, the 10 and 100 caps on the overview, and `markAllPaid` leaving upcoming lessons alone.

## Fixes from the review of PR #11

These were found reviewing PR #11 and still apply. Fold them in as the files are ported; don't bolt them on afterwards.

1. **Root `tsconfig.json` excludes `admin`.** Otherwise the public site's `astro check` type-checks the admin against packages that aren't installed at the root. This broke CI on PR #11.
2. **`@types/node` is a dev dependency of `admin/`.** The tests use `process` and `node:fs`. Without it `astro check` fails in a clean checkout.
3. **The middleware catches errors.** A thrown error returns a 500 through `errorResponse` with the security headers and a fixed message, and logs the error with `console.error`. No stack traces to the browser.
4. **Mark paid reports what happened.** When the update changes no rows, redirect with the `nothing-to-pay` notice instead of claiming success.
5. **The lesson forms check the student exists.** The student list is already loaded for the select. If the posted `student_id` isn't in it, return 422 with "Pick a student" rather than hitting the foreign key and 500ing.
6. **The CSV starts with a UTF-8 byte-order mark** so Excel shows "Zoë" correctly.
7. **The end-to-end CSV test puts its formula in an exported column.** PR #11's test put `=HYPERLINK(...)` in private notes, which aren't exported, so it proved nothing. Put it in `covered` and assert the exported cell starts with an apostrophe.
8. **`safeBack` rejects control characters and backslashes.** Browsers strip tabs from URLs, so `/\t/evil.com` would redirect off-site. Reject anything matching `/[\x00-\x1f\\]/`.
9. **Delete a student deletes their lessons, and the confirm says so.** This was a permissions bug in PR #11. With one user it's the intended behaviour, and the confirm text already warns.

Not carried over, on purpose: concurrent-edit protection, thousands-separator strictness in the money parser, CSP hashes for the three inline scripts, HSTS in the app. One user, one tab, and HSTS belongs on the zone (see `deploy.md`).

## Local sign-in

A browser can't add the Access header, so `astro dev` needs a way in. Keep PR #11's mechanism: if `import.meta.env.DEV` is true and `DEV_EMAIL` is set in `admin/.dev.vars`, the verifier returns that email. `import.meta.env.DEV` is false at build time, so the branch is removed from every build. `npm run check:bundle` greps the build for `DEV_EMAIL` and fails if it's there.

## Tests

| Suite | What | Needs |
| --- | --- | --- |
| `npm run test:unit` | money, tax year, CSV, validation, forms, Access tokens, the guard, security helpers, HTTP helpers | Nothing |
| `npm run test:e2e` | The production build behind the fake Access server, against a local D1 | `npx playwright install chromium` |
| `npm run check` | `wrangler types` then `astro check` | Nothing |
| `npm run check:bundle` | The dev sign-in isn't in the build | Nothing |

The unit tests come from PR #11 with the permissions and wrangler-sync tests removed and the guard test simplified. There are no database tests: every query runs through the end-to-end suite via the pages.

The end-to-end suite comes from PR #11 with these changes:

- Global setup resets the local D1 (delete the persisted state directory, then apply migrations locally) instead of resetting Postgres and seeding staff rows.
- "Refuses a signed-in email with no staff record" becomes "refuses a signed-in email that isn't allowed", using an email not in `ALLOWED_EMAILS`.
- The read-only staff member test goes.
- The CSV formula test is fixed (above).
- One new test: the tax-year boundary. Log lessons on 5 April and 6 April, request `/export.csv?tax_year=` for each year, and check which lines appear. This replaces the one valuable database test.

The fake Access server (`tests/e2e/fake-access.mjs`) stays as it is. It mints a fresh RS256 key per run on `127.0.0.1`, so nothing in production could ever trust it.

**One gotcha to settle first.** The migrate command and the server under test must share one local D1. Wrangler persists local state under `.wrangler/state` relative to the config file it was given, and the Astro adapter copies the config into `dist/server/`. Pass the same `--persist-to` directory to `wrangler d1 migrations apply --local` and to the preview server, and confirm with a quick manual run before writing the rest of the suite.
