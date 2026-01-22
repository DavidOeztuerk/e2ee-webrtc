#!/bin/bash
set -e

# Update system
dnf update -y

# Install coturn
dnf install -y coturn

# Get public IP
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)

# Configure coturn
cat > /etc/turnserver.conf <<EOF
# Network settings
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
relay-ip=$PUBLIC_IP
external-ip=$PUBLIC_IP

# Authentication
use-auth-secret
static-auth-secret=${turn_secret}
realm=${realm}

# TLS (configure your certificates)
# cert=/etc/letsencrypt/live/${realm}/fullchain.pem
# pkey=/etc/letsencrypt/live/${realm}/privkey.pem

# TURN relay ports
min-port=49152
max-port=65535

# Logging
log-file=/var/log/turnserver/turnserver.log
verbose

# Security
fingerprint
lt-cred-mech
no-multicast-peers
no-cli
no-tlsv1
no-tlsv1_1

# Performance
proc-quota=100
stale-nonce=600
max-allocate-lifetime=3600
channel-lifetime=600
permission-lifetime=300

# Limits
total-quota=1000
bps-capacity=0
user-quota=12

# WebRTC optimizations
mobility
no-tcp-relay
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
EOF

# Create log directory
mkdir -p /var/log/turnserver
chown turnserver:turnserver /var/log/turnserver

# Enable and start coturn
systemctl enable coturn
systemctl start coturn

# Install certbot for TLS
dnf install -y certbot

# Set up certificate renewal cron
echo "0 0 1 * * root certbot renew --quiet && systemctl reload coturn" > /etc/cron.d/certbot

echo "TURN server setup complete"
echo "Public IP: $PUBLIC_IP"
echo "STUN: stun:$PUBLIC_IP:3478"
echo "TURN: turn:$PUBLIC_IP:3478"
