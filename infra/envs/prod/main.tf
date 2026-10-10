# The prod admin: Supabase project, Access, custom domain, Hyperdrive.

variable "account_id" { type = string }
variable "supabase_org_id" { type = string }
variable "allowed_emails" { type = list(string) }
variable "database_password" {
  type        = string
  sensitive   = true
  description = "The postgres superuser password for the new project. TF_VAR_database_password."
}
variable "admin_worker_password" {
  type        = string
  sensitive   = true
  description = "Set on the admin_worker role by hand after migrations (see admin/README.md). TF_VAR_admin_worker_password."
}
variable "db_host" {
  type        = string
  description = "Postgres host for Hyperdrive. See infra/README.md: direct or Supavisor session pooler."
}
variable "db_user" {
  type    = string
  default = "admin_worker"
}

data "terraform_remote_state" "account" {
  backend = "s3"
  config  = merge(local.backend, { key = "account/terraform.tfstate" })
}

data "cloudflare_zone" "withchris" {
  filter = { name = "withchris.uk" }
}

module "supabase" {
  source            = "../../modules/supabase"
  organization_id   = var.supabase_org_id
  name              = "withchris-prod"
  database_password = var.database_password
  instance_size     = "small"
}

module "admin" {
  source         = "../../modules/admin"
  account_id     = var.account_id
  zone_id        = data.cloudflare_zone.withchris.zone_id
  hostname       = "admin.withchris.uk"
  worker_name    = "withchris-admin"
  allowed_emails = var.allowed_emails
  idp_ids        = [data.terraform_remote_state.account.outputs.otp_idp_id]
  db_host        = var.db_host
  db_user        = var.db_user
  db_password    = var.admin_worker_password
}

# Read by infra/scripts/sync-wrangler.mjs and written into admin/wrangler.jsonc.
output "wrangler" {
  value = {
    env                = "prod"
    access_team_domain = data.terraform_remote_state.account.outputs.team_domain
    access_aud         = module.admin.aud
    hyperdrive_id      = module.admin.hyperdrive_id
  }
}

output "supabase" {
  value = { ref = module.supabase.ref, url = module.supabase.url }
}
