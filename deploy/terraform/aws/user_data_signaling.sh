#!/bin/bash
set -e

# Update system
dnf update -y

# Install Docker
dnf install -y docker
systemctl enable docker
systemctl start docker

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Create app directory
mkdir -p /opt/e2ee-webrtc
cd /opt/e2ee-webrtc

# Create environment file
cat > .env <<EOF
REDIS_URL=redis://${redis_endpoint}:${redis_port}
NODE_ENV=${environment}
PORT=3001
LOG_LEVEL=info
EOF

# Create docker-compose file
cat > docker-compose.yml <<EOF
version: '3.8'

services:
  signaling:
    image: ghcr.io/your-org/e2ee-signaling:latest
    ports:
      - "3001:3001"
    environment:
      - REDIS_URL=\${REDIS_URL}
      - NODE_ENV=\${NODE_ENV}
      - PORT=\${PORT}
      - LOG_LEVEL=\${LOG_LEVEL}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
EOF

# Start services
docker-compose up -d

# Install CloudWatch agent for logging
dnf install -y amazon-cloudwatch-agent

cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<EOF
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/docker/*.log",
            "log_group_name": "/e2ee-webrtc/signaling",
            "log_stream_name": "{instance_id}"
          }
        ]
      }
    }
  }
}
EOF

systemctl enable amazon-cloudwatch-agent
systemctl start amazon-cloudwatch-agent

echo "Signaling server setup complete"
