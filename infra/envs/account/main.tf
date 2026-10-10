# Account-wide settings, applied once and rarely changed. Staging and prod read its outputs.

variable "account_id" { type = string }
variable "team_name" { type = string }

module "account" {
  source     = "../../modules/account"
  account_id = var.account_id
  team_name  = var.team_name
}

# The Zero Trust organisation already exists (one per account): adopt it, don't create it.
import {
  to = module.account.cloudflare_zero_trust_organization.this
  id = var.account_id
}

output "team_domain" { value = module.account.team_domain }
output "otp_idp_id" { value = module.account.otp_idp_id }
