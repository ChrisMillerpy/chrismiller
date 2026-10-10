# One Supabase project and its settings. Tables, roles and RLS are migrations, not Terraform.

terraform {
  required_providers {
    supabase = { source = "supabase/supabase" }
  }
}

variable "organization_id" { type = string }
variable "name" { type = string }
variable "region" {
  type    = string
  default = "eu-west-2" # London
}
variable "instance_size" {
  type        = string
  default     = null
  description = "Compute size. Null lets Supabase use the organisation's default (nano on Free)."
}
variable "database_password" {
  type      = string
  sensitive = true
}

resource "supabase_project" "this" {
  organization_id   = var.organization_id
  name              = var.name
  database_password = var.database_password
  region            = var.region
  instance_size     = var.instance_size

  lifecycle {
    # Changing these would mean a new project, and losing the database.
    prevent_destroy = true
    ignore_changes  = [database_password]
  }
}

resource "supabase_settings" "this" {
  project_ref = supabase_project.this.id

  # The admin doesn't use the Data API. Expose nothing until something needs it; RLS covers it anyway.
  api = jsonencode({
    db_schema            = "public"
    db_extra_search_path = "public, extensions"
    max_rows             = 1000
  })

  # No student or parent logins yet.
  auth = jsonencode({
    disable_signup = true
  })
}

output "ref" { value = supabase_project.this.id }
output "url" { value = "https://${supabase_project.this.id}.supabase.co" }
