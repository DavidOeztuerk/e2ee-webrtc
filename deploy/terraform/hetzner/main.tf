# Hetzner Cloud Terraform Configuration for E2EE WebRTC Infrastructure
# Cost-effective European hosting option

terraform {
  required_version = ">= 1.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }

  backend "s3" {
    # Configure your backend (can use any S3-compatible storage)
    # bucket   = "terraform-state"
    # key      = "e2ee-webrtc/hetzner/terraform.tfstate"
    # endpoint = "https://s3.eu-central-1.amazonaws.com"
    # region   = "eu-central-1"
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

# Variables
variable "hcloud_token" {
  description = "Hetzner Cloud API Token"
  type        = string
  sensitive   = true
}

variable "location" {
  description = "Hetzner datacenter location"
  type        = string
  default     = "fsn1" # Falkenstein, Germany
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

variable "ssh_public_key" {
  description = "SSH public key for server access"
  type        = string
}

variable "signaling_server_type" {
  description = "Server type for signaling"
  type        = string
  default     = "cpx21" # 3 vCPU, 4GB RAM
}

variable "turn_server_type" {
  description = "Server type for TURN"
  type        = string
  default     = "cpx31" # 4 vCPU, 8GB RAM
}

# SSH Key
resource "hcloud_ssh_key" "main" {
  name       = "e2ee-webrtc-key"
  public_key = var.ssh_public_key
}

# Private Network
resource "hcloud_network" "main" {
  name     = "e2ee-webrtc-network"
  ip_range = "10.0.0.0/16"
}

resource "hcloud_network_subnet" "signaling" {
  network_id   = hcloud_network.main.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.0.1.0/24"
}

resource "hcloud_network_subnet" "turn" {
  network_id   = hcloud_network.main.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.0.2.0/24"
}

# Firewall for Signaling
resource "hcloud_firewall" "signaling" {
  name = "e2ee-signaling-fw"

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "22"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
    description = "SSH"
  }

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "80"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
    description = "HTTP"
  }

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "443"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
    description = "HTTPS/WSS"
  }

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "3001"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
    description = "Signaling WebSocket"
  }

  rule {
    direction = "in"
    protocol  = "icmp"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
    description = "ICMP"
  }
}

# Firewall for TURN
resource "hcloud_firewall" "turn" {
  name = "e2ee-turn-fw"

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "22"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
    description = "SSH"
  }

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "3478"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
    description = "STUN/TURN TCP"
  }

  rule {
    direction = "in"
    protocol  = "udp"
    port      = "3478"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
    description = "STUN/TURN UDP"
  }

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "5349"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
    description = "TURNS"
  }

  rule {
    direction = "in"
    protocol  = "udp"
    port      = "49152-65535"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
    description = "TURN relay ports"
  }

  rule {
    direction = "in"
    protocol  = "icmp"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
    description = "ICMP"
  }
}

# Signaling Servers
resource "hcloud_server" "signaling" {
  count       = var.environment == "production" ? 2 : 1
  name        = "e2ee-signaling-${count.index + 1}"
  server_type = var.signaling_server_type
  location    = var.location
  image       = "ubuntu-22.04"
  ssh_keys    = [hcloud_ssh_key.main.id]
  firewall_ids = [hcloud_firewall.signaling.id]

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  network {
    network_id = hcloud_network.main.id
    ip         = "10.0.1.${count.index + 10}"
  }

  user_data = templatefile("${path.module}/cloud_init_signaling.yaml", {
    environment    = var.environment
    redis_host     = hcloud_server.redis.ipv4_address
    redis_password = random_password.redis.result
  })

  labels = {
    role        = "signaling"
    environment = var.environment
  }

  depends_on = [hcloud_network_subnet.signaling]
}

# TURN Servers
resource "hcloud_server" "turn" {
  count       = var.environment == "production" ? 2 : 1
  name        = "e2ee-turn-${count.index + 1}"
  server_type = var.turn_server_type
  location    = var.location
  image       = "ubuntu-22.04"
  ssh_keys    = [hcloud_ssh_key.main.id]
  firewall_ids = [hcloud_firewall.turn.id]

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  network {
    network_id = hcloud_network.main.id
    ip         = "10.0.2.${count.index + 10}"
  }

  user_data = templatefile("${path.module}/cloud_init_turn.yaml", {
    turn_secret = var.turn_secret
    realm       = var.domain_name
  })

  labels = {
    role        = "turn"
    environment = var.environment
  }

  depends_on = [hcloud_network_subnet.turn]
}

# Redis Server
resource "random_password" "redis" {
  length  = 32
  special = false
}

resource "hcloud_server" "redis" {
  name        = "e2ee-redis"
  server_type = "cpx11" # 2 vCPU, 2GB RAM
  location    = var.location
  image       = "ubuntu-22.04"
  ssh_keys    = [hcloud_ssh_key.main.id]

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  network {
    network_id = hcloud_network.main.id
    ip         = "10.0.1.100"
  }

  user_data = templatefile("${path.module}/cloud_init_redis.yaml", {
    redis_password = random_password.redis.result
  })

  labels = {
    role        = "redis"
    environment = var.environment
  }

  depends_on = [hcloud_network_subnet.signaling]
}

# Load Balancer for Signaling
resource "hcloud_load_balancer" "signaling" {
  name               = "e2ee-signaling-lb"
  load_balancer_type = "lb11"
  location           = var.location

  labels = {
    role        = "load-balancer"
    environment = var.environment
  }
}

resource "hcloud_load_balancer_network" "signaling" {
  load_balancer_id = hcloud_load_balancer.signaling.id
  network_id       = hcloud_network.main.id
  ip               = "10.0.1.200"
}

resource "hcloud_load_balancer_target" "signaling" {
  count            = var.environment == "production" ? 2 : 1
  type             = "server"
  load_balancer_id = hcloud_load_balancer.signaling.id
  server_id        = hcloud_server.signaling[count.index].id
  use_private_ip   = true
}

resource "hcloud_load_balancer_service" "https" {
  load_balancer_id = hcloud_load_balancer.signaling.id
  protocol         = "https"
  listen_port      = 443
  destination_port = 3001
  proxyprotocol    = false

  http {
    sticky_sessions = true
    cookie_name     = "SERVERID"
    cookie_lifetime = 300
    certificates    = [hcloud_managed_certificate.main.id]
  }

  health_check {
    protocol = "http"
    port     = 3001
    interval = 15
    timeout  = 10
    retries  = 3

    http {
      path         = "/health"
      status_codes = ["200"]
    }
  }
}

resource "hcloud_load_balancer_service" "http" {
  load_balancer_id = hcloud_load_balancer.signaling.id
  protocol         = "http"
  listen_port      = 80
  destination_port = 80
  proxyprotocol    = false

  health_check {
    protocol = "http"
    port     = 80
    interval = 15
    timeout  = 10
    retries  = 3
  }
}

# Managed Certificate
resource "hcloud_managed_certificate" "main" {
  name         = "e2ee-cert"
  domain_names = [var.domain_name, "*.${var.domain_name}"]
}

# Floating IPs for TURN (for DNS stability)
resource "hcloud_floating_ip" "turn" {
  count         = var.environment == "production" ? 2 : 1
  type          = "ipv4"
  home_location = var.location
  name          = "e2ee-turn-ip-${count.index + 1}"

  labels = {
    role = "turn"
  }
}

resource "hcloud_floating_ip_assignment" "turn" {
  count          = var.environment == "production" ? 2 : 1
  floating_ip_id = hcloud_floating_ip.turn[count.index].id
  server_id      = hcloud_server.turn[count.index].id
}

# Volumes for persistent data
resource "hcloud_volume" "redis" {
  name      = "e2ee-redis-data"
  size      = 10
  location  = var.location
  format    = "ext4"

  labels = {
    role = "redis"
  }
}

resource "hcloud_volume_attachment" "redis" {
  volume_id = hcloud_volume.redis.id
  server_id = hcloud_server.redis.id
  automount = true
}

# Outputs
output "load_balancer_ipv4" {
  description = "Load balancer IPv4 address"
  value       = hcloud_load_balancer.signaling.ipv4
}

output "load_balancer_ipv6" {
  description = "Load balancer IPv6 address"
  value       = hcloud_load_balancer.signaling.ipv6
}

output "signaling_server_ips" {
  description = "Signaling server public IPs"
  value       = hcloud_server.signaling[*].ipv4_address
}

output "turn_floating_ips" {
  description = "TURN server floating IPs"
  value       = hcloud_floating_ip.turn[*].ip_address
}

output "turn_server_ips" {
  description = "TURN server public IPs"
  value       = hcloud_server.turn[*].ipv4_address
}

output "redis_private_ip" {
  description = "Redis private IP"
  value       = "10.0.1.100"
}

output "redis_password" {
  description = "Redis password"
  value       = random_password.redis.result
  sensitive   = true
}
