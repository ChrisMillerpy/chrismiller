terraform {
  # 1.10+ for S3-native state locking (use_lockfile). OpenTofu 1.10+ works too.
  required_version = ">= 1.10"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.26.0"
    }
    supabase = {
      source  = "supabase/supabase"
      version = "1.11.0"
    }
  }

  # State lives in the R2 bucket made by hand in bootstrap (see infra/README.md).
  # Account id and keys come from backend.hcl and the environment, not from here.
  backend "s3" {}
}

# Token from CLOUDFLARE_API_TOKEN; never in a file.
provider "cloudflare" {}

# Token from SUPABASE_ACCESS_TOKEN; never in a file.
provider "supabase" {}
