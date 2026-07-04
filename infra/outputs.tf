output "db_endpoint" {
  description = "PostgreSQL database endpoint address"
  value       = aws_db_instance.main.address
}

output "db_port" {
  description = "PostgreSQL database port"
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "Application database name"
  value       = aws_db_instance.main.db_name
}

output "app_service_name" {
  description = "Name of the ECS service running the application"
  value       = aws_ecs_service.app.name
}
