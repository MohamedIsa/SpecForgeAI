variable "aws_region" {
  description = "AWS region where resources are provisioned"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}

variable "project_name" {
  description = "Name of the project used for resource naming"
  type        = string
  default     = "specforge"
}

variable "db_password" {
  description = "Master password for the PostgreSQL database"
  type        = string
  sensitive   = true
}

variable "db_username" {
  description = "Master username for the PostgreSQL database"
  type        = string
  default     = "specforge_admin"
  sensitive   = true
}

variable "db_name" {
  description = "Name of the application database"
  type        = string
  default     = "specforge"
}

variable "db_instance_class" {
  description = "RDS instance class for PostgreSQL"
  type        = string
  default     = "db.t3.micro"
}

variable "db_storage_gb" {
  description = "Allocated storage for the database in GB"
  type        = number
  default     = 20
}

variable "app_port" {
  description = "Port the application listens on"
  type        = number
  default     = 3001
}

variable "app_container_image" {
  description = "Docker image for the application container"
  type        = string
  default     = "specforge/backend:latest"
}

variable "app_desired_count" {
  description = "Number of application tasks to run"
  type        = number
  default     = 1
}

variable "tf_plan_offline" {
  description = "When true, skips AWS credential validation for offline scaffold dry-runs"
  type        = bool
  default     = true
}

variable "aws_access_key" {
  description = "AWS access key (scaffold-only dummy; set tf_plan_offline=false for real credentials)"
  type        = string
  default     = "dummy"
}

variable "aws_secret_key" {
  description = "AWS secret key (scaffold-only dummy; set tf_plan_offline=false for real credentials)"
  type        = string
  default     = "dummy"
  sensitive   = true
}
