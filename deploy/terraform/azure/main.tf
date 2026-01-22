# Azure Terraform Configuration for E2EE WebRTC Infrastructure

terraform {
  required_version = ">= 1.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }

  backend "azurerm" {
    # Configure your backend
    # resource_group_name  = "terraform-state-rg"
    # storage_account_name = "tfstate12345"
    # container_name       = "tfstate"
    # key                  = "e2ee-webrtc.tfstate"
  }
}

provider "azurerm" {
  features {}
}

# Variables
variable "location" {
  description = "Azure region"
  type        = string
  default     = "West Europe"
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

variable "signaling_sku" {
  description = "SKU for signaling VMs"
  type        = string
  default     = "Standard_B2s"
}

variable "turn_sku" {
  description = "SKU for TURN VMs"
  type        = string
  default     = "Standard_D2s_v3"
}

# Resource Group
resource "azurerm_resource_group" "main" {
  name     = "e2ee-webrtc-${var.environment}-rg"
  location = var.location

  tags = {
    Project     = "e2ee-webrtc"
    Environment = var.environment
  }
}

# Virtual Network
resource "azurerm_virtual_network" "main" {
  name                = "e2ee-webrtc-vnet"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_subnet" "signaling" {
  name                 = "signaling-subnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]
}

resource "azurerm_subnet" "turn" {
  name                 = "turn-subnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.2.0/24"]
}

resource "azurerm_subnet" "redis" {
  name                 = "redis-subnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.3.0/24"]
}

# Network Security Groups
resource "azurerm_network_security_group" "signaling" {
  name                = "signaling-nsg"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  security_rule {
    name                       = "HTTPS"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "HTTP"
    priority                   = 101
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "WebSocket"
    priority                   = 102
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3001"
    source_address_prefix      = "AzureLoadBalancer"
    destination_address_prefix = "*"
  }
}

resource "azurerm_network_security_group" "turn" {
  name                = "turn-nsg"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  security_rule {
    name                       = "STUN-TCP"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3478"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "STUN-UDP"
    priority                   = 101
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Udp"
    source_port_range          = "*"
    destination_port_range     = "3478"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "TURNS"
    priority                   = 102
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "5349"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "TURN-Relay"
    priority                   = 103
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Udp"
    source_port_range          = "*"
    destination_port_range     = "49152-65535"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

# Azure Cache for Redis
resource "azurerm_redis_cache" "main" {
  name                = "e2ee-webrtc-redis"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  capacity            = var.environment == "production" ? 1 : 0
  family              = var.environment == "production" ? "P" : "C"
  sku_name            = var.environment == "production" ? "Premium" : "Basic"
  enable_non_ssl_port = false
  minimum_tls_version = "1.2"

  redis_configuration {
    maxmemory_policy = "volatile-lru"
  }
}

# Public IP for Application Gateway
resource "azurerm_public_ip" "appgw" {
  name                = "e2ee-appgw-pip"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

# Application Gateway Subnet
resource "azurerm_subnet" "appgw" {
  name                 = "appgw-subnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.10.0/24"]
}

# Application Gateway for Signaling
resource "azurerm_application_gateway" "main" {
  name                = "e2ee-appgw"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  sku {
    name     = "Standard_v2"
    tier     = "Standard_v2"
    capacity = var.environment == "production" ? 2 : 1
  }

  gateway_ip_configuration {
    name      = "gateway-ip-config"
    subnet_id = azurerm_subnet.appgw.id
  }

  frontend_port {
    name = "https-port"
    port = 443
  }

  frontend_port {
    name = "http-port"
    port = 80
  }

  frontend_ip_configuration {
    name                 = "frontend-ip"
    public_ip_address_id = azurerm_public_ip.appgw.id
  }

  backend_address_pool {
    name = "signaling-pool"
  }

  backend_http_settings {
    name                                = "signaling-settings"
    cookie_based_affinity               = "Enabled"
    port                                = 3001
    protocol                            = "Http"
    request_timeout                     = 120
    connection_draining {
      enabled           = true
      drain_timeout_sec = 60
    }
    probe_name = "signaling-probe"
  }

  probe {
    name                = "signaling-probe"
    protocol            = "Http"
    path                = "/health"
    host                = "127.0.0.1"
    interval            = 30
    timeout             = 10
    unhealthy_threshold = 3
  }

  http_listener {
    name                           = "https-listener"
    frontend_ip_configuration_name = "frontend-ip"
    frontend_port_name             = "https-port"
    protocol                       = "Https"
    ssl_certificate_name           = "ssl-cert"
  }

  http_listener {
    name                           = "http-listener"
    frontend_ip_configuration_name = "frontend-ip"
    frontend_port_name             = "http-port"
    protocol                       = "Http"
  }

  ssl_certificate {
    name     = "ssl-cert"
    data     = filebase64("${path.module}/certificate.pfx")
    password = var.ssl_cert_password
  }

  request_routing_rule {
    name                       = "https-rule"
    priority                   = 100
    rule_type                  = "Basic"
    http_listener_name         = "https-listener"
    backend_address_pool_name  = "signaling-pool"
    backend_http_settings_name = "signaling-settings"
  }

  redirect_configuration {
    name                 = "http-to-https"
    redirect_type        = "Permanent"
    target_listener_name = "https-listener"
    include_path         = true
    include_query_string = true
  }

  request_routing_rule {
    name                        = "http-redirect"
    priority                    = 101
    rule_type                   = "Basic"
    http_listener_name          = "http-listener"
    redirect_configuration_name = "http-to-https"
  }
}

variable "ssl_cert_password" {
  description = "Password for SSL certificate"
  type        = string
  sensitive   = true
  default     = ""
}

# Virtual Machine Scale Set for Signaling
resource "azurerm_linux_virtual_machine_scale_set" "signaling" {
  name                = "e2ee-signaling-vmss"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = var.signaling_sku
  instances           = var.environment == "production" ? 2 : 1
  admin_username      = "adminuser"

  admin_ssh_key {
    username   = "adminuser"
    public_key = file("~/.ssh/id_rsa.pub")
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts"
    version   = "latest"
  }

  os_disk {
    storage_account_type = "Standard_LRS"
    caching              = "ReadWrite"
  }

  network_interface {
    name    = "signaling-nic"
    primary = true

    ip_configuration {
      name                                         = "internal"
      primary                                      = true
      subnet_id                                    = azurerm_subnet.signaling.id
      application_gateway_backend_address_pool_ids = [
        one(azurerm_application_gateway.main.backend_address_pool).id
      ]
    }
  }

  custom_data = base64encode(templatefile("${path.module}/cloud_init_signaling.yaml", {
    redis_host = azurerm_redis_cache.main.hostname
    redis_key  = azurerm_redis_cache.main.primary_access_key
    redis_port = azurerm_redis_cache.main.ssl_port
  }))

  tags = {
    Environment = var.environment
  }
}

# TURN Server VMs
resource "azurerm_public_ip" "turn" {
  count               = var.environment == "production" ? 2 : 1
  name                = "e2ee-turn-pip-${count.index + 1}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_network_interface" "turn" {
  count               = var.environment == "production" ? 2 : 1
  name                = "e2ee-turn-nic-${count.index + 1}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.turn.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.turn[count.index].id
  }
}

resource "azurerm_network_interface_security_group_association" "turn" {
  count                     = var.environment == "production" ? 2 : 1
  network_interface_id      = azurerm_network_interface.turn[count.index].id
  network_security_group_id = azurerm_network_security_group.turn.id
}

resource "azurerm_linux_virtual_machine" "turn" {
  count               = var.environment == "production" ? 2 : 1
  name                = "e2ee-turn-${count.index + 1}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  size                = var.turn_sku
  admin_username      = "adminuser"
  network_interface_ids = [
    azurerm_network_interface.turn[count.index].id
  ]

  admin_ssh_key {
    username   = "adminuser"
    public_key = file("~/.ssh/id_rsa.pub")
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts"
    version   = "latest"
  }

  custom_data = base64encode(templatefile("${path.module}/cloud_init_turn.yaml", {
    turn_secret = var.turn_secret
    realm       = var.domain_name
    public_ip   = azurerm_public_ip.turn[count.index].ip_address
  }))
}

# Outputs
output "application_gateway_ip" {
  description = "Public IP of Application Gateway"
  value       = azurerm_public_ip.appgw.ip_address
}

output "turn_public_ips" {
  description = "Public IPs of TURN servers"
  value       = azurerm_public_ip.turn[*].ip_address
}

output "redis_hostname" {
  description = "Redis hostname"
  value       = azurerm_redis_cache.main.hostname
}

output "redis_ssl_port" {
  description = "Redis SSL port"
  value       = azurerm_redis_cache.main.ssl_port
}
