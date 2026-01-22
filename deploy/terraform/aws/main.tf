# AWS Terraform Configuration for E2EE WebRTC Infrastructure
# This deploys signaling server, TURN/STUN servers, and supporting infrastructure

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    # Configure your backend
    # bucket = "your-terraform-state-bucket"
    # key    = "e2ee-webrtc/terraform.tfstate"
    # region = "eu-central-1"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "e2ee-webrtc"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Variables
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "eu-central-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "domain_name" {
  description = "Domain name for the services"
  type        = string
}

variable "turn_secret" {
  description = "TURN server shared secret"
  type        = string
  sensitive   = true
}

variable "instance_type_signaling" {
  description = "EC2 instance type for signaling server"
  type        = string
  default     = "t3.small"
}

variable "instance_type_turn" {
  description = "EC2 instance type for TURN server"
  type        = string
  default     = "c5.large"
}

# VPC Configuration
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "e2ee-webrtc-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

  enable_nat_gateway     = true
  single_nat_gateway     = var.environment != "production"
  enable_dns_hostnames   = true
  enable_dns_support     = true

  tags = {
    Name = "e2ee-webrtc-vpc"
  }
}

# Security Group for Signaling Server
resource "aws_security_group" "signaling" {
  name        = "e2ee-signaling-sg"
  description = "Security group for signaling server"
  vpc_id      = module.vpc.vpc_id

  # WebSocket traffic
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS/WSS"
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP (redirect to HTTPS)"
  }

  # Health check from ALB
  ingress {
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
    description     = "Health check"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "e2ee-signaling-sg"
  }
}

# Security Group for TURN Server
resource "aws_security_group" "turn" {
  name        = "e2ee-turn-sg"
  description = "Security group for TURN server"
  vpc_id      = module.vpc.vpc_id

  # STUN/TURN ports
  ingress {
    from_port   = 3478
    to_port     = 3478
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "STUN/TURN TCP"
  }

  ingress {
    from_port   = 3478
    to_port     = 3478
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "STUN/TURN UDP"
  }

  ingress {
    from_port   = 5349
    to_port     = 5349
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "TURNS TCP"
  }

  # TURN relay ports
  ingress {
    from_port   = 49152
    to_port     = 65535
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "TURN relay range"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "e2ee-turn-sg"
  }
}

# Security Group for ALB
resource "aws_security_group" "alb" {
  name        = "e2ee-alb-sg"
  description = "Security group for ALB"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "e2ee-alb-sg"
  }
}

# ElastiCache Redis for session storage
resource "aws_elasticache_subnet_group" "redis" {
  name       = "e2ee-redis-subnet"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "e2ee-redis"
  description                = "Redis for E2EE WebRTC signaling"
  node_type                  = "cache.t3.micro"
  port                       = 6379
  parameter_group_name       = "default.redis7"
  automatic_failover_enabled = var.environment == "production"
  num_cache_clusters         = var.environment == "production" ? 2 : 1
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  tags = {
    Name = "e2ee-redis"
  }
}

resource "aws_security_group" "redis" {
  name        = "e2ee-redis-sg"
  description = "Security group for Redis"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.signaling.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "e2ee-redis-sg"
  }
}

# ACM Certificate
resource "aws_acm_certificate" "main" {
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Application Load Balancer
resource "aws_lb" "signaling" {
  name               = "e2ee-signaling-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = module.vpc.public_subnets

  enable_deletion_protection = var.environment == "production"

  tags = {
    Name = "e2ee-signaling-alb"
  }
}

resource "aws_lb_target_group" "signaling" {
  name        = "e2ee-signaling-tg"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "instance"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 2
  }

  # Enable sticky sessions for WebSocket
  stickiness {
    type            = "lb_cookie"
    cookie_duration = 86400
    enabled         = true
  }

  tags = {
    Name = "e2ee-signaling-tg"
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.signaling.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.main.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.signaling.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.signaling.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# Launch Template for Signaling Server
resource "aws_launch_template" "signaling" {
  name_prefix   = "e2ee-signaling-"
  image_id      = data.aws_ami.amazon_linux_2023.id
  instance_type = var.instance_type_signaling

  network_interfaces {
    associate_public_ip_address = false
    security_groups             = [aws_security_group.signaling.id]
  }

  iam_instance_profile {
    name = aws_iam_instance_profile.signaling.name
  }

  user_data = base64encode(templatefile("${path.module}/user_data_signaling.sh", {
    redis_endpoint = aws_elasticache_replication_group.redis.primary_endpoint_address
    redis_port     = 6379
    environment    = var.environment
  }))

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "e2ee-signaling"
    }
  }
}

# Auto Scaling Group for Signaling
resource "aws_autoscaling_group" "signaling" {
  name                = "e2ee-signaling-asg"
  vpc_zone_identifier = module.vpc.private_subnets
  target_group_arns   = [aws_lb_target_group.signaling.arn]
  health_check_type   = "ELB"

  min_size         = var.environment == "production" ? 2 : 1
  max_size         = var.environment == "production" ? 10 : 3
  desired_capacity = var.environment == "production" ? 2 : 1

  launch_template {
    id      = aws_launch_template.signaling.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "e2ee-signaling"
    propagate_at_launch = true
  }
}

# TURN Server EC2 Instance
resource "aws_instance" "turn" {
  count         = var.environment == "production" ? 2 : 1
  ami           = data.aws_ami.amazon_linux_2023.id
  instance_type = var.instance_type_turn
  subnet_id     = module.vpc.public_subnets[count.index % length(module.vpc.public_subnets)]

  vpc_security_group_ids = [aws_security_group.turn.id]

  associate_public_ip_address = true

  user_data = base64encode(templatefile("${path.module}/user_data_turn.sh", {
    turn_secret = var.turn_secret
    realm       = var.domain_name
  }))

  tags = {
    Name = "e2ee-turn-${count.index + 1}"
  }
}

# Elastic IP for TURN servers
resource "aws_eip" "turn" {
  count    = var.environment == "production" ? 2 : 1
  instance = aws_instance.turn[count.index].id
  domain   = "vpc"

  tags = {
    Name = "e2ee-turn-eip-${count.index + 1}"
  }
}

# IAM Role for Signaling Servers
resource "aws_iam_role" "signaling" {
  name = "e2ee-signaling-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "signaling_ssm" {
  role       = aws_iam_role.signaling.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "signaling" {
  name = "e2ee-signaling-profile"
  role = aws_iam_role.signaling.name
}

# Data sources
data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Outputs
output "alb_dns_name" {
  description = "ALB DNS name for signaling server"
  value       = aws_lb.signaling.dns_name
}

output "turn_public_ips" {
  description = "Public IPs of TURN servers"
  value       = aws_eip.turn[*].public_ip
}

output "redis_endpoint" {
  description = "Redis endpoint"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}
