terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "local" {
    path = "terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region

  access_key                  = var.tf_plan_offline ? var.aws_access_key : null
  secret_key                  = var.tf_plan_offline ? var.aws_secret_key : null
  skip_credentials_validation = var.tf_plan_offline
  skip_requesting_account_id  = var.tf_plan_offline

  shared_config_files      = var.tf_plan_offline ? ["/dev/null"] : null
  shared_credentials_files = var.tf_plan_offline ? ["/dev/null"] : null

  default_tags {
    tags = {
      Environment = var.environment
      Project     = var.project_name
      ManagedBy   = "terraform"
    }
  }
}
