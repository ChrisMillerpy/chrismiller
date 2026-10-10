# The same values as backend.hcl, for reading the account state. Keep the two in step.
locals {
  backend = {
    bucket                      = "withchris-tfstate"
    region                      = "auto"
    endpoints                   = { s3 = "https://${var.account_id}.r2.cloudflarestorage.com" }
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
    use_path_style              = true
  }
}
