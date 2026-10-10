# The admin for one environment: its Access app and policy, its custom domain, and the
# Hyperdrive config the Worker reaches Postgres through. The Worker itself is deployed by wrangler.

terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare" }
  }
}

variable "account_id" { type = string }
variable "hostname" {
  type        = string
  description = "Where the admin is reached: admin.withchris.uk, or the Worker's workers.dev address."
}
variable "attach_custom_domain" {
  type        = bool
  default     = true
  description = "False while the admin runs on its workers.dev address (Access still guards it)."
}
variable "zone_id" {
  type    = string
  default = null
}
variable "worker_name" {
  type        = string
  description = "Must already exist: deploy the Worker once with wrangler before applying."
}
variable "allowed_emails" {
  type        = list(string)
  description = "Who Access lets through. Each also needs an active row in the staff table."
}
variable "idp_ids" { type = list(string) }
variable "session_duration" {
  type    = string
  default = "24h"
}

variable "db_host" { type = string }
variable "db_port" {
  type    = number
  default = 5432
}
variable "db_name" {
  type    = string
  default = "postgres"
}
variable "db_user" {
  type        = string
  description = "The admin_worker login (with the project-ref suffix if going through Supavisor)."
}
variable "db_password" {
  type      = string
  sensitive = true
}

resource "cloudflare_zero_trust_access_policy" "staff" {
  account_id = var.account_id
  name       = "${var.hostname}: staff"
  decision   = "allow"
  include    = [for e in var.allowed_emails : { email = { email = e } }]
}

resource "cloudflare_zero_trust_access_application" "admin" {
  account_id                = var.account_id
  name                      = var.hostname
  domain                    = var.hostname
  type                      = "self_hosted"
  session_duration          = var.session_duration
  allowed_idps              = var.idp_ids
  auto_redirect_to_identity = length(var.idp_ids) == 1
  app_launcher_visible      = false
  policies                  = [{ id = cloudflare_zero_trust_access_policy.staff.id, precedence = 1 }]
}

resource "cloudflare_workers_custom_domain" "admin" {
  count      = var.attach_custom_domain ? 1 : 0
  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = var.hostname
  service    = var.worker_name

  # Access must be in front before the hostname exists.
  depends_on = [cloudflare_zero_trust_access_application.admin]
}

resource "cloudflare_hyperdrive_config" "admin" {
  account_id = var.account_id
  name       = "${var.worker_name}-db"
  origin = {
    scheme   = "postgresql"
    host     = var.db_host
    port     = var.db_port
    database = var.db_name
    user     = var.db_user
    password = var.db_password
  }
  # Admin pages must never show stale money figures.
  caching = { disabled = true }
}

output "aud" { value = cloudflare_zero_trust_access_application.admin.aud }
output "hyperdrive_id" { value = cloudflare_hyperdrive_config.admin.id }
