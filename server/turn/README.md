# TURN Server Configuration

This directory contains configuration for the TURN (Traversal Using Relays around NAT) server using coturn.

## Overview

TURN servers relay media when direct peer-to-peer connections are not possible due to NAT or firewall restrictions. For E2EE, the TURN server only sees encrypted data - it cannot decrypt the media content.

## Quick Start

### Using Docker

```bash
# Run coturn with docker
docker run -d --name coturn \
  -p 3478:3478 -p 3478:3478/udp \
  -p 5349:5349 -p 5349:5349/udp \
  -p 49152-65535:49152-65535/udp \
  -e TURN_SECRET=your-secret-here \
  -e TURN_REALM=example.com \
  coturn/coturn
```

### Using Docker Compose

See `../docker/docker-compose.yml` for the production configuration.

### Manual Installation

On Ubuntu/Debian:

```bash
apt-get update
apt-get install -y coturn

# Edit /etc/turnserver.conf with your configuration
# Enable coturn in /etc/default/coturn

systemctl enable coturn
systemctl start coturn
```

## Configuration

### turnserver.conf

```conf
# Network settings
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
relay-ip=YOUR_PUBLIC_IP
external-ip=YOUR_PUBLIC_IP

# Authentication
use-auth-secret
static-auth-secret=YOUR_TURN_SECRET
realm=your-domain.com

# TLS (recommended for production)
cert=/etc/letsencrypt/live/your-domain.com/fullchain.pem
pkey=/etc/letsencrypt/live/your-domain.com/privkey.pem

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

# Deny private networks
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
```

## Generating TURN Credentials

For time-limited credentials (recommended):

```javascript
const crypto = require('crypto');

function generateTurnCredentials(secret, username, ttlSeconds = 86400) {
  const timestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const tempUsername = `${timestamp}:${username}`;
  const password = crypto
    .createHmac('sha1', secret)
    .update(tempUsername)
    .digest('base64');

  return {
    username: tempUsername,
    password: password,
    ttl: ttlSeconds,
    uris: [
      'stun:turn.example.com:3478',
      'turn:turn.example.com:3478',
      'turn:turn.example.com:3478?transport=tcp',
    ],
  };
}
```

## Testing

### Using turnutils

```bash
# Test STUN
turnutils_stunclient turn.example.com

# Test TURN
turnutils_uclient -t -u username -w password turn.example.com
```

### Using Trickle ICE

Visit https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

Enter your TURN server details and click "Gather candidates" to test connectivity.

## Firewall Rules

Required ports:

| Port | Protocol | Description |
|------|----------|-------------|
| 3478 | TCP/UDP | STUN/TURN |
| 5349 | TCP | TURNS (TLS) |
| 49152-65535 | UDP | TURN relay range |

Example iptables rules:

```bash
# STUN/TURN
iptables -A INPUT -p udp --dport 3478 -j ACCEPT
iptables -A INPUT -p tcp --dport 3478 -j ACCEPT

# TURNS
iptables -A INPUT -p tcp --dport 5349 -j ACCEPT

# Relay ports
iptables -A INPUT -p udp --dport 49152:65535 -j ACCEPT
```

## Monitoring

### Prometheus Metrics

Coturn can export metrics. Enable in config:

```conf
prometheus
```

Then scrape from port 9641.

### Log Analysis

Key log entries to monitor:

```bash
# Connection attempts
grep "new connection" /var/log/turnserver/turnserver.log

# Allocation failures
grep "allocation error" /var/log/turnserver/turnserver.log

# Authentication failures
grep "cannot find credentials" /var/log/turnserver/turnserver.log
```

## Scaling

For high availability:

1. Deploy multiple TURN servers in different regions
2. Use DNS round-robin or a load balancer
3. Each client should receive multiple TURN server URIs as fallbacks

```javascript
const iceServers = [
  {
    urls: [
      'turn:turn1.example.com:3478',
      'turn:turn2.example.com:3478',
      'turn:turn3.example.com:3478',
    ],
    username: credentials.username,
    credential: credentials.password,
  },
];
```

## Security Considerations

1. **Always use time-limited credentials** - Never use static passwords
2. **Enable TLS** - Use TURNS (port 5349) for encrypted TURN connections
3. **Deny private networks** - Prevent relay to internal resources
4. **Rate limiting** - Configure `user-quota` and `total-quota`
5. **Monitoring** - Watch for unusual traffic patterns
6. **Certificate rotation** - Keep TLS certificates up to date

## Troubleshooting

### "Allocation quota reached"

Increase quotas in config:
```conf
total-quota=1000
user-quota=12
```

### "Stale nonce"

The nonce has expired. Increase `stale-nonce` value or ensure client handles 401 responses properly.

### "Cannot create socket"

Check if ports are already in use:
```bash
netstat -tulpn | grep -E '(3478|5349)'
```

### TLS handshake failures

Verify certificate chain:
```bash
openssl s_client -connect turn.example.com:5349 -servername turn.example.com
```
