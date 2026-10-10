# Login and security

Two locks on the door, both cheap, both from PR #11. Then nothing else: no staff table, no permissions, no policies.

## How a request gets in

1. **Cloudflare Access** sits in front of the hostname. Its policy allows a short list of emails and sends a one-time code by email. Anyone else never reaches the Worker. Access is free for up to 50 users.
2. **The token check** (`src/lib/access.ts`, unchanged from PR #11). Access attaches a signed token to every request in the `Cf-Access-Jwt-Assertion` header. The app verifies it against the team's published signing keys with the algorithm pinned to RS256, the issuer pinned to the team domain, and the audience pinned to this app's AUD tag. The email comes from the verified payload, never from a header. Any failure, including a missing `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD`, refuses the request. A misconfigured or removed Access policy fails closed.
3. **The allow-list.** `ALLOWED_EMAILS` in `wrangler.jsonc` is a comma-separated list. The verified email must be on it, compared lower-case. Empty list means nobody gets in. This replaces the `staff` table and is the whole of authorisation.

The guard (`src/lib/guard.ts`) runs these in order on every request, after the Origin check below, and before any page. It's the only place that decides who's in.

Why keep the token check when Access already guards the hostname? Because it's 35 lines, Cloudflare recommends it, and it means a mistake in the dashboard exposes nothing. Why keep an allow-list in the app when Access has one? Because it's 5 lines and means a mistake in the Access policy exposes nothing either. Both checks are the cost of being able to stop thinking about the dashboard.

## Hardening, unchanged from PR #11

- **Cross-site form posts are refused.** Any method other than GET, HEAD or OPTIONS must carry an `Origin` header equal to the request's own origin. Missing or `null` is refused. This runs first, before the token check, on every route including the `paid` endpoints.
- **Every mutation is a POST followed by a 303 redirect.** Nothing changes data on GET. Notices after a redirect come from a fixed table, never from the URL.
- **Response headers** on every response the middleware handles, including 403s, 404s, 500s, redirects and the CSV: `cache-control: no-store`, `x-frame-options: DENY`, `referrer-policy: same-origin`, `x-robots-tag: noindex, nofollow`, `x-content-type-options: nosniff`, and a content security policy with `default-src 'self'`, `form-action 'self'`, `frame-ancestors 'none'` and `base-uri 'none'`. `referrer-policy` must stay `same-origin`: with `no-referrer`, Chrome sends `Origin: null` on the app's own form posts.
- **No `workers.dev` and no preview URLs** once the custom domain is live, so the hostname behind Access is the only way in. Until the domain moves (see `deploy.md`), the Worker runs on its `workers.dev` address with an Access application in front of that address, which PR #11's staging proved works.
- **Every value in SQL is bound.** No string interpolation into queries.
- **Every form field is validated on the server** in `validate.ts`, with limits matching the database's check constraints. Values are preserved on error with a 422.
- **HTML is escaped by Astro.** There is no `set:html` anywhere. The error page escapes its message.
- **The CSV neutralises formulas.** Cells starting with `=`, `+`, `-`, `@`, tab or carriage return get an apostrophe. Cells with commas, quotes or newlines are quoted.
- **Redirect targets from forms** must be a path on this site. See fix 8 in `app.md`.

## The dev sign-in

Under `astro dev` only, with `DEV_EMAIL` set in `admin/.dev.vars`, the verifier returns that email without a token. The allow-list still applies, so `.dev.vars` also sets `ALLOWED_EMAILS`. It's gated on `import.meta.env.DEV`, which is a compile-time constant, so it's absent from every build. `npm run check:bundle` proves that on every CI run. The e2e suite doesn't use it; it runs the production build behind the fake Access server.

## Threat model, in five lines

- Someone on the internet: stopped by Access at the edge. Never reaches the Worker.
- Someone with a token for a different Access app in the same team: stopped by the audience check.
- Someone the Access policy wrongly admits: stopped by `ALLOWED_EMAILS`.
- A page on another site trying to post a form as Chris: stopped by the Origin check.
- A spreadsheet opening the export: formulas neutralised.

Not defended against, on purpose: Chris's own email account being compromised, and Cloudflare itself. Both are outside what a tutoring admin can fix.

## What was dropped

| From PR #11 | Replaced by |
| --- | --- |
| `staff` table with `permissions text[]` and `active` | `ALLOWED_EMAILS` variable |
| Six permission strings, `can()`, `need()`, nav filtering by permission | Everyone who's in can do everything |
| Row-level security on four tables, 13 policies, four security-definer helpers | Nothing. One user. |
| Per-transaction `set_config('role', 'authenticated')` and claims | Nothing. D1 has one caller. |
| `audit_log` and the trigger | `updated_at` columns, and D1 Time Travel for recovery |
| The `admin_worker` login role and its password | D1 is a binding. No password. |

When a second person needs in, add their email to the Access policy and to `ALLOWED_EMAILS`. That's the whole procedure. If they need less than everything, design permissions then, against what they actually need.
