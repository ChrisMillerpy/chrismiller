# Plan: infrastructure as code (`infra/`)

Terraform for the Cloudflare account and the Supabase projects behind withchris.uk. Built first for the admin ([`admin-user-account-plan.md`](admin-user-account-plan.md)), and shaped so the harness ([`harness-plan.md`](../harness-plan.md)) can add its resources later without restructuring.

**Status (2026-10-10):** written and validated, not yet applied (`infra/`; how to run it is in [`infra/README.md`](../infra/README.md)). Owned by the admin workstream, because the admin ships first. When harness work starts, it adds its resources through the admin inbox, or this moves to joint ownership.

## Why now

Revision 1 of the admin plan rejected Terraform: six one-time dashboard settings didn't justify a state file and a wide API token. It named three reasons to revisit, and two now apply:

- **Staging and production copies.** The admin moves to Supabase with a staging project, so every Access app, hostname and Hyperdrive config exists twice.
- **More domains and rules.** `admin.`, `admin-staging.`, and *later* `harness.` and its service tokens, R2 buckets and Containers.

Clicking the same settings twice by hand, and keeping them identical, is exactly what Terraform is for.

## What Terraform manages, and what it doesn't

| Layer | Tool | Examples |
| --- | --- | --- |
| Account and zone resources that change rarely | **Terraform** | Access apps, policies, identity providers; DNS records; Worker custom domains; Hyperdrive configs; R2 buckets; Supabase projects and their settings |
| Worker code, bindings and deploys | **wrangler** | `wrangler.jsonc`, `admin/wrangler.jsonc`, Workers Builds |
| Database schema and RLS | **Supabase migrations** | `supabase/migrations/*.sql` |
| Secrets | **Neither checked in** | Worker secrets via `wrangler secret put` (or CI); Terraform's own credentials from the environment |

Rules:

- **Terraform never manages Worker scripts.** Wrangler deploys code, and two tools owning one Worker fight over its settings. Terraform creates what the Worker *binds to* and outputs the ids; wrangler reads them.
- **Terraform never holds schema.** Tables and policies are SQL in migrations, reviewed and tested like code.
- **Nothing is changed in the dashboard** for anything Terraform manages. A scheduled `terraform plan` in CI reports drift.

## Tool and versions

- **Terraform or OpenTofu:** both read the same code. Recommendation: **OpenTofu** (open-source licence, client-side state encryption built in). Terraform is fine if Chris prefers it. See open questions.
- **Providers**, pinned exactly in `versions.tf`, with the lock file committed:
  - `cloudflare/cloudflare` v5. v5 renamed many resources (for example `cloudflare_record` → `cloudflare_dns_record`, Access resources under `cloudflare_zero_trust_access_*`). Write against v5 only; don't copy v4 examples.
  - `supabase/supabase`, for `supabase_project` and `supabase_settings` (API, auth and database settings).
- Upgrades by a deliberate PR, with the `plan` output in the description.

## Layout

```
infra/
  modules/
    account/        # Zero Trust organisation (imported) and the one-time-PIN login method
    admin/          # Access app + policy, custom domain, Hyperdrive config for one environment
    supabase/       # one Supabase project + settings
    # later: harness/ (hostname, Access app + service token, R2, Container registry)
  envs/
    account/        # account-wide, own state; staging and prod read its outputs
    staging/        # main.tf calls the modules with staging values; own state
    prod/           # same, with prod values; own state
  backend.hcl.example
  README.md         # bootstrap (by hand), first-apply order, credentials
```

Each environment has its own state file, so a staging apply can never touch prod.

## Resources, first version (admin only)

Per environment:

| Resource | Notes |
| --- | --- |
| `supabase_project` | London (`eu-west-2`); Pro plan for prod. Database password generated and stored as a sensitive value. |
| `supabase_settings` | Exposed API schemas kept minimal; auth sign-ups off (no student logins yet). |
| `cloudflare_hyperdrive_config` | Points at the project's pooler, as the `admin_worker` role. Its password is created by a migration and passed in as a variable. |
| `cloudflare_zero_trust_access_application` | Self-hosted, `admin.withchris.uk` / `admin-staging.withchris.uk`; short session (for example 24 h) |
| `cloudflare_zero_trust_access_policy` | Allow; include Chris's email. The email list is a variable, so a staff member is one line. |
| `cloudflare_workers_custom_domain` | `admin.` / `admin-staging.` on the `withchris-admin` / `withchris-admin-staging` Worker. The Worker must exist first (one wrangler deploy). |

Account-wide, once:

| Resource | Notes |
| --- | --- |
| Access identity provider | One-time PIN (and Google, if chosen) |
| `cloudflare_zero_trust_organization` | Read for the team domain; import, don't recreate |

**Outputs** per environment: Access team domain, AUD tag, Hyperdrive id, Supabase project ref and URL. The admin's deploy reads these. They aren't secret (the AUD tag and team domain appear in every Access token), so they go into `admin/wrangler.jsonc` per environment through `admin/scripts/sync-wrangler.mjs`, which reads `terraform output -json wrangler` and keeps the file's comments.

*Later*, for the harness: `harness.withchris.uk`, an Access app with a service-token policy for the TUI, R2 buckets for worksheets and submissions, Container and Sandbox settings, egress rules.

## Bringing in what already exists

Terraform must adopt these, not recreate them, using `import` blocks (reviewed in a plan that shows 0 to destroy):

| Existing | Action |
| --- | --- |
| The `withchris.uk` zone | Read as a data source; never managed (too much to lose) |
| DNS records for the public site and email routing | Import the ones we touch; leave the rest alone |
| The `chrismiller` Worker (public site) and its domain | Leave to wrangler; import the custom domain only if we change it |
| Email routing rules | Leave in the dashboard for now; import later if they change |
| D1 `withchris-admin` | Don't import. Delete by hand once the admin runs on Postgres (it has no tables). |
| Zero Trust organisation | Import (one per account) |

## State and credentials

- **State backend:** an R2 bucket `withchris-tfstate`, through the `s3` backend (R2 is S3-compatible), one key per environment. Versioning-equivalent protection: object lifecycle keeps old versions. OpenTofu's state encryption is on, with the key in Chris's password manager.
  - Check during step 1: whether native S3 state locking (`use_lockfile`) works against R2. If not, accept no locking (one person applies) or use HCP Terraform's free tier as the backend instead.
- **Bootstrap:** the bucket and tokens below are created once in the dashboard (the chicken-and-egg), and recorded in `infra/bootstrap/README.md`.
- **Cloudflare API tokens, scoped narrowly:**
  - `tf-plan`: read-only on Access, DNS, Workers, Hyperdrive, R2. Used by CI for drift checks and PR plans.
  - `tf-apply`: edit on those same resources. Used only for applies.
  - Neither has account-admin, billing or member permissions.
- **Supabase:** a personal access token for the new withchris org only.
- **Where they live:** in Chris's password manager, exported into the shell for local applies. Never in `.env` files in the repo, never in Terraform variables files.
- `.gitignore` adds `.terraform/`, `*.tfstate*`, `*.tfvars` (except `*.tfvars.example`).

## How changes run

- **Locally first.** While it's one person, `tofu plan` and `tofu apply` run from Chris's laptop, staging before prod.
- **CI** (GitHub Actions): on any PR touching `infra/`, `fmt`, `validate` and `plan` for both environments with the read-only token, with the plan posted to the PR. A weekly scheduled `plan` against prod reports drift.
- **Applies from CI** come later, if ever: they would put the apply token in GitHub. Not worth it for one person.
- **Prod applies** are always reviewed: the plan must show no destroys unless the PR says why.

## Build steps

1. **Bootstrap:** create the state bucket and the two Cloudflare tokens; the new Supabase org and its access token. Check R2 locking.
2. **Skeleton:** `infra/` layout, providers pinned, backend configured, `.gitignore` updated, `tofu init` for both environments.
3. **Imports:** Zero Trust organisation, then a plan that shows nothing to change.
4. **Staging:** the Supabase project, the identity provider, the Access app and policy for `admin-staging.withchris.uk`. Apply.
5. **Admin hand-off:** run the migrations (admin plan), set the `admin_worker` password, create the Hyperdrive config, deploy the staging Worker once, then attach its custom domain.
6. **Outputs → wrangler:** the sync script, and the CI check.
7. **Prod:** the same modules with prod values, after the admin passes on staging.
8. **CI:** PR plans and the weekly drift check.

## Risks

- **Provider churn:** Cloudflare's v5 provider is generated from their API and has had breaking changes between minor versions. Pin exactly and upgrade on purpose.
- **Losing state:** with no state, Terraform would try to recreate everything. R2 keeps old versions; the bootstrap README says how to restore one.
- **A leaked apply token** could change Access policies. Kept off CI and out of the repo, scoped to the resources above, and rotated if a laptop is lost.
- **Two sources of truth for Access emails:** Terraform's policy list and the `staff` table. Removing someone means removing them in both. *Later*, generate the policy list from `staff`, or check one against the other in CI.

## Open questions for Chris

1. **OpenTofu or Terraform?** Recommended: OpenTofu.
2. **State:** R2 (free, in the same account) or HCP Terraform's free tier (locking and a UI, but another account)? Recommended: R2.
3. **Supabase org:** a new org just for withchris? Recommended: yes.
4. **Staging:** a second Supabase project, or branching on prod (see the admin plan)?
5. **Email routing and existing DNS:** leave in the dashboard for now, or import everything on day one? Recommended: leave, import when they next change.
