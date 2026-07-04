resource "aws_db_instance" "main" {
  identifier = "${var.project_name}-${var.environment}"

  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_storage_gb
  max_allocated_storage = var.db_storage_gb * 2

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  port = 5432

  vpc_security_group_ids = [aws_security_group.db.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name

  storage_encrypted   = true
  deletion_protection = var.environment == "prod"

  skip_final_snapshot       = var.environment != "prod"
  final_snapshot_identifier = "${var.project_name}-${var.environment}-final"

  backup_retention_period = var.environment == "prod" ? 30 : 7

  tags = {
    Name = "${var.project_name}-${var.environment}-db"
  }
}

resource "aws_security_group" "db" {
  name        = "${var.project_name}-${var.environment}-db-sg"
  description = "Security group for PostgreSQL database"

  ingress {
    description = "PostgreSQL from application"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-db-sg"
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-subnet-group"
  subnet_ids = ["subnet-placeholder-a", "subnet-placeholder-b"]

  tags = {
    Name = "${var.project_name}-${var.environment}-subnet-group"
  }
}
