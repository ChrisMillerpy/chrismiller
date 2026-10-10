# Account-wide Zero Trust settings, shared by every environment. Applied from envs/prod only.

terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare" }
  }
}

variable "account_id" { type = string }
variable "team_name" {
  type        = string
  description = "The <team> in <team>.cloudflareaccess.com. Already exists; imported, not created."
}

# One per account. Imported (see envs/prod/imports.tf), never recreated.
resource "cloudflare_zero_trust_organization" "this" {
  account_id  = var.account_id
  name        = var.team_name
  auth_domain = "${var.team_name}.cloudflareaccess.com"
}

resource "cloudflare_zero_trust_access_identity_provider" "otp" {
  account_id = var.account_id
  name       = "One-time PIN"
  type       = "onetimepin"
  config     = {}
}

output "team_domain" { value = "https://${cloudflare_zero_trust_organization.this.auth_domain}" }
output "otp_idp_id" { value = cloudflare_zero_trust_access_identity_provider.otp.id }
