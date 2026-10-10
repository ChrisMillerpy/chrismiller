# infra

Terraform for the Cloudflare account and the Supabase projects. Plan and reasoning: [`plans/infra-plan.md`](../plans/infra-plan.md).

| Folder | State key | What |
| --- | --- | --- |
| `envs/account` | `account/terraform.tfstate` | Zero Trust organisation (imported), the one-time-PIN login method |
| `envs/staging` | `staging/terraform.tfstate` | Supabase `withchris-staging`; `admin-staging.withchris.uk`: Access app and policy, custom domain, Hyperdrive |
| `envs/prod` | `prod/terraform.tfstate` | Supabase `withchris-prod`; `admin.withchris.uk`: the same |

Terraform never manages Worker code (wrangler does) or tables and policies (`supabase/migrations/` does). Works with Terraform 1.10+ or OpenTofu 1.10+.

## Credentials

Secrets live in the macOS Keychain and are loaded into the shell only when running Terraform. Nothing secret goes in a file.

```sh
./infra/creds.sh set CLOUDFLARE_API_TOKEN     # prompts for the value; repeat for each name below
./infra/creds.sh list                         # what's set
eval "$(./infra/creds.sh env)"                # before terraform, in that shell only
```

Non-secret settings (account id, Supabase org id, emails, `db_host`) go in `backend.hcl` and each env's `terraform.tfvars`, both git-ignored.

| Variable | What | Scope |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare provider | Account: Access: Apps and Policies Edit; Access: Organizations, Identity Providers, and Groups Edit; Hyperdrive Edit; Workers Scripts Edit. Zone withchris.uk only: Zone Read, DNS Edit, Workers Routes Edit. |
| `SUPABASE_ACCESS_TOKEN` | Supabase provider | A personal access token in the withchris org |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | State in R2 | R2 → Manage API tokens: Object Read & Write on `withchris-tfstate` only |
| `TF_VAR_database_password` | New project's `postgres` password | Generate (`openssl rand -hex 24`: no characters that need escaping in a connection URL) |
| `TF_VAR_admin_worker_password` | The `admin_worker` login, for Hyperdrive | Generate; also pasted once into the SQL editor (`./infra/creds.sh get TF_VAR_admin_worker_password \| pbcopy`) |

## Bootstrap (once, by hand)

1. **Cloudflare:** create the R2 bucket `withchris-tfstate`, an R2 API token for it, and the API token above.
2. **Supabase:** create a new organisation for withchris, and a personal access token.
3. Move the account to **Workers Paid**.
4. Store each secret: `./infra/creds.sh set <NAME>` for every row in the table above.
5. `cp backend.hcl.example backend.hcl` and fill in the account id. Same for each env's `terraform.tfvars.example` → `terraform.tfvars`.

## First apply

The order matters: Hyperdrive checks it can log in when it's created, and a custom domain needs its Worker to exist.

```sh
eval "$(./creds.sh env)"   # from infra/
init() { terraform -chdir=envs/$1 init -backend-config=../../backend.hcl -backend-config="key=$1/terraform.tfstate"; }

# 1. Account: adopts the Zero Trust organisation (the plan must show 1 import, 0 destroy).
init account && terraform -chdir=envs/account apply

# 2. Staging database.
init staging && terraform -chdir=envs/staging apply -target=module.supabase

# 3. Schema, from the repo root, then the worker's password (admin/README.md).
supabase link --project-ref <staging ref> && supabase db push

# 4. Deploy the Worker once so it exists (it refuses every request until configured).
#    Locally, because CI's deploy refuses to run until step 6 has filled in wrangler.jsonc.
(cd ../admin && npx wrangler login && npm run deploy:staging)

# 5. Everything else: Access, the custom domain, Hyperdrive.
terraform -chdir=envs/staging apply

# 6. Put the outputs into wrangler.jsonc and commit them. Merging to main deploys through GitHub Actions.
terraform -chdir=envs/staging output -json wrangler | node ../admin/scripts/sync-wrangler.mjs
```

Then add Chris's staff row (admin/README.md), check the admin on staging, and repeat steps 2–6 for `prod`. Finally, delete the unused D1 database `withchris-admin` in the dashboard.

## GitHub Actions

Deploys run from GitHub Actions, not Cloudflare's Workers Builds:

| Workflow | On a pull request | On merge to `main` |
| --- | --- | --- |
| `site.yml` (withchris.uk) | Check, build, publish a preview (`wrangler preview`), with its URL in the job summary | Deploy |
| `admin.yml` | Type check, every test, `terraform validate` | Same checks, then staging (migrate and deploy), then production after approval |

Set up once in **GitHub → Settings → Environments**. Each environment holds its own secrets, so a staging job can never see production's:

| Environment | Protection | Secrets | Variables |
| --- | --- | --- | --- |
| `preview` | None | `CLOUDFLARE_API_TOKEN` | `CLOUDFLARE_ACCOUNT_ID` |
| `site-production` | Deploy from `main` only | `CLOUDFLARE_API_TOKEN` | `CLOUDFLARE_ACCOUNT_ID` |
| `staging` | Deploy from `main` only | `CLOUDFLARE_API_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` (staging's `postgres` password) | `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_PROJECT_REF` |
| `production` | `main` only, **required reviewer: Chris** | Same names, production's values | Same names, production's values |

The Cloudflare token for GitHub is a **deploy token**, separate from Terraform's. It's the "Edit Cloudflare Workers" template, limited to this account and the withchris.uk zone. It can't change Access, DNS or Hyperdrive.

Then **turn off Workers Builds** on the `chrismiller` Worker (Workers & Pages → chrismiller → Settings → Builds → Disconnect), or every merge deploys twice.

Terraform itself still runs from your machine. CI only runs `fmt` and `validate`, so the token that can change Access policies never goes to GitHub.

## The database host for Hyperdrive

To check on the first apply (`db_host`, `db_user`):

- **Direct:** `db.<ref>.supabase.co`, port 5432, user `admin_worker`. Supabase's direct host is IPv6-only unless the IPv4 add-on is bought; check Hyperdrive can reach it.
- **Supavisor session pooler:** `aws-0-eu-west-2.pooler.supabase.com`, port 5432, user `admin_worker.<ref>`. Works over IPv4.

Either way, Hyperdrive does the pooling for the Worker, and query caching is off.

## Day to day

- Change `.tf` files in a PR. CI runs `fmt` and `validate`.
- `terraform plan` before every apply. A prod plan that destroys anything needs a reason in the PR.
- Nothing Terraform manages is edited in the dashboard.
