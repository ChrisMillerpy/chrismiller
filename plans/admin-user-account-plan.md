# Plan: private admin at admin.withchris.uk

A private area, only for Chris, to run the tutoring business: students, the lessons taught to them, and who has paid.

**Status:** the first version is built and tested on the `admin-account-users` branch. The production database exists in Cloudflare and has its tables. The admin isn't deployed yet: that needs the dashboard steps under [Setup](#setup).

## Goals

- One login, Chris's own, and nobody else can get in.
- Keep student and parent details, lesson notes and payments in one place, instead of in Gmail and memory.
- See at a glance what's owed and what's been earned, and export a year's lessons for the tax return.
- Change nothing about the public site, `withchris.uk`: it stays static, fast and free.
- Stay on the free Cloudflare plan, in the same account as the domain, site and email.

Out of scope for the first version: logins for students or parents, online payments, calendar sync, and automatic emails. See [Later](#later).

## Decisions

### A subdomain and a separate Worker

The admin lives at `admin.withchris.uk` as its own Cloudflare Worker, built from an `admin/` folder in this repo.

- The public site keeps no server code. Nothing in the admin can break or slow it down.
- The two deploy separately, so a blog post doesn't redeploy the admin.
- Being in the same repo lets the admin reuse the site's colours and fonts from `src/styles/global.css`.

The alternative was `/admin/*` on the main site. It would have meant adding server code to the public site and an Access rule on a path rather than a whole hostname, which is easier to get wrong.

### Login: Cloudflare Access

Cloudflare Access sits in front of `admin.withchris.uk` and only lets one email address through. It sends a one-time code by email, or can use Google sign-in. It's free for up to 50 users.

- No passwords, sessions, sign-up or password-reset pages to write and secure.
- Protecting a whole hostname is simpler and safer than protecting a path.

**Second lock.** Cloudflare's docs say an app behind Access should also check the signed token Access adds to each request (the `Cf-Access-Jwt-Assertion` header). The admin checks that token on every request: it must be signed by the account's Access keys, for this app's AUD tag, from the right team domain. If the token, the AUD tag or the team domain is missing, every request is refused. So a misconfigured or missing Access policy fails closed, and the data is never exposed.

### Database: Cloudflare D1

D1 is a small SQLite database in the same Cloudflare account. The free tier is far beyond what one tutor needs. It also keeps automatic point-in-time backups (Time Travel).

Supabase was considered and rejected: it would be a second provider and account for the same job.

### Framework: Astro with the Cloudflare adapter

This matches the public site, so the same components, styles and conventions apply. Every admin page is rendered per request (`output: 'server'`). Forms post back to the page they're on, so there's almost no client-side JavaScript.

### Not Terraform

The infrastructure that matters is already in code: `wrangler.jsonc` (Worker, database binding, Access settings) and `migrations/` (tables). What's left is about six one-time dashboard settings: the Access app and policy, domains, DNS and email routing. Terraform would add a state file to store and protect, a wide-permission API token, provider upgrades and drift from dashboard edits, all to manage those six settings.

It's worth revisiting if someone else helps run the account, if staging and production copies are needed, or if the number of domains and rules grows. A cheaper step first: declare the custom domain in `wrangler.jsonc` (`"routes": [{ "pattern": "admin.withchris.uk", "custom_domain": true }]`) so it's created on deploy.

### Not off-the-shelf tutoring software

Tools like TutorBird and Teachworks do scheduling, invoicing and parent portals for roughly £10–20 a month, and a Google Sheet would also go a long way. Building our own is free to run, fits exactly how Chris works, and sits with the rest of the site. The cost is maintaining it ourselves.

## Data model

Money is stored in pence (integers) to avoid rounding errors.

**students**

| Field | Notes |
| --- | --- |
| `name` | Required |
| `level`, `exam_board` | GCSE / A Level / A Level + Further / Admissions test / Other; AQA, Edexcel, OCR, OCR MEI, MAT… |
| `student_email` | Optional |
| `parent_name`, `parent_email`, `parent_phone` | |
| `rate_pence` | Usual price per lesson, used when logging a lesson |
| `status` | `active`, `paused` or `finished` |
| `notes` | Goals, target grade, what they find hard |

**lessons**

| Field | Notes |
| --- | --- |
| `student_id` | Deleting a student deletes their lessons |
| `date`, `time` | `YYYY-MM-DD`; time is optional |
| `minutes` | Default 60 |
| `price_pence` | Defaults to the student's rate, can be changed for one lesson |
| `covered`, `homework`, `notes` | Notes are private |
| `paid_on` | Date paid, or empty while unpaid |

Lessons dated in the future count as upcoming, not owed.

## Pages

| Page | What it shows |
| --- | --- |
| Overview `/` | Earned this month, owed, earned this UK tax year; upcoming lessons; unpaid lessons with a "Mark paid" button |
| Students `/students` | Filter by active, paused, finished or all; level, parent, last lesson, amount owed |
| Student `/students/:id` | Contact details, notes, totals, every lesson, "Mark all paid" |
| Add / edit student | Includes delete, which warns that it removes their lessons too |
| Lessons `/lessons` | Taught, upcoming or unpaid; CSV links for the last three tax years |
| Log / edit lesson | Picking a student fills in their rate |
| Export `/export.csv` | Lessons between two dates, or everything, as CSV |

The tax year runs from 6 April to 5 April, matching HMRC Self Assessment.

## Security

- **Access** in front of the whole hostname, allowing one email address.
- **Token check** on every request, failing closed (see above).
- **No `workers.dev` or preview URLs**, so the custom domain behind Access is the only way in.
- **Form posts** are only accepted when the `Origin` header matches the admin's own address.
- **Response headers:** `no-store` caching, `DENY` framing, `same-origin` referrer, and `noindex`.
- **CSV export** prefixes cells starting with `=`, `+`, `-` or `@` so a spreadsheet app can't treat them as formulas.
- **SQL:** every value goes through bound parameters.

## Research notes and gotchas

Findings from building and testing the first version:

- **The adapter creates a KV namespace by default.** `@astrojs/cloudflare` turns on Astro sessions backed by KV and provisions the namespace on deploy. Access already handles login, so the config sets `session: false` and no KV is created.
- **It also adds a Cloudflare Images binding by default.** The admin has no images, so `imageService: 'passthrough'` avoids it.
- **`Referrer-Policy: no-referrer` breaks the Origin check.** With that header, Chrome sends `Origin: null` on form posts, so the admin's own forms were refused. The header is now `same-origin`, which still sends nothing to other sites. Testing caught this.
- **Generated Workers types clash with browser DOM types** in client scripts during `astro check`. The one small client script, which fills in a student's rate, is an inline plain-JS script.
- **Local preview reads `.dev.vars` from `dist/server/`** for the built Worker, not from `admin/`.
- **The production schema was applied through the Cloudflare API**, so a `d1_migrations` row for `0001_init.sql` was added by hand. That keeps `npm run db:migrate` (`wrangler d1 migrations apply --remote`) from trying to run it again.

## Testing done

- An end-to-end browser run against a local database covered:
  - adding a student, with validation of a missing name
  - the rate filling in automatically
  - logging past, future and discounted lessons
  - overview totals
  - "Mark paid" and "Mark all paid"
  - editing a lesson
  - CSV quoting
  - no horizontal scrolling at phone width
- **Production build, token checks:**
  - With no Access settings, every page returns 403.
  - With test settings and a local signing key, a correct token gets in.
  - Tokens with the wrong audience, wrong signing key or wrong issuer return 403.
- `astro check` passes for the admin and the public site, and the public site builds unchanged.

## Setup

Already done:

- [x] D1 database `withchris-admin` created, in western Europe.
- [x] Tables created in production.

Dashboard steps, about 15 minutes:

- [ ] **Create the Worker.** *Workers & Pages → Create → Import a repository*, this repo:
  - project name `withchris-admin`
  - root directory `admin`
  - build command `npm run build`
  - deploy command `npx wrangler deploy`
  - build watch paths `admin/*` and `src/styles/*`
- [ ] **Add the domain.** Custom domain `admin.withchris.uk` on that Worker.
- [ ] **Set up Access.** *Zero Trust → Access → Applications → Self-hosted* for `admin.withchris.uk`:
  - policy: Allow, Include Emails, with Chris's address
  - login method: One-time PIN
- [ ] **Connect the two.** Put the team domain (`https://<team>.cloudflareaccess.com`) and the app's AUD tag into `admin/wrangler.jsonc`, then push.

Until the last step is done, the admin refuses every request, so the order is safe.

## Data protection

The admin stores personal details about children and their parents, so UK GDPR applies.

- Keep only what's needed.
- Delete students who've finished and whose records aren't needed for tax.
- Access is limited to one person.
- Check on the ICO website whether the yearly data protection fee is due. Small businesses that keep client records usually need to pay it.

## Later

In rough order of usefulness:

1. **Enquiries from `/learn`.** A contact form on the public site that saves to the admin, through a small public endpoint on the admin Worker with spam protection (Cloudflare Turnstile).
2. **Calendar feed.** An `.ics` URL of upcoming lessons to subscribe to from Google Calendar.
3. **Monthly statements.** A per-student summary of lessons and amount due, ready to email to a parent.
4. **Payments.** Stripe payment links on statements, with paid status updated automatically.
5. **Reminder emails.** Day-before lesson reminders to parents.

## Open questions

- Which login method: email one-time PIN only, or Google sign-in too?
- Should finished students be kept for a set time and then deleted? Tax records generally need keeping for about 5 years after the filing deadline.
- Which of the [Later](#later) items matters first?
