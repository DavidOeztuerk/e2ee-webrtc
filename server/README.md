# E2EE WebRTC Server Components

Self-hosted infrastructure for end-to-end encrypted video calls.

## Components

### Signaling Server (`signaling/`)

WebSocket server handling:
- Room management
- WebRTC offer/answer exchange
- ICE candidate relay
- Encrypted key distribution (keys never decrypted server-side)

### TURN Server (`turn/`)

NAT traversal using coturn:
- STUN for connection candidates
- TURN relay for symmetric NAT

### SFU (`sfu/`)

Optional Selective Forwarding Unit for multi-party calls:
- mediasoup configuration
- Scalable video routing

## Quick Start

### Development

```bash
cd docker
docker-compose up -d
```

Services:
- Signaling: `ws://localhost:3000`
- TURN: `turn:localhost:3478`
- Redis: `localhost:6379`

### Production

See `deploy/docker/` for production-ready configuration with:
- Traefik reverse proxy
- Let's Encrypt SSL
- Horizontal scaling
- Monitoring

## Security

- All encryption keys are exchanged end-to-end
- Server only relays encrypted key material
- No key material is logged or stored
- TURN credentials should be rotated regularly

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client A  │────▶│  Signaling  │◀────│   Client B  │
│  (Browser)  │     │   Server    │     │  (Browser)  │
└──────┬──────┘     └─────────────┘     └──────┬──────┘
       │                                        │
       │         ┌─────────────┐               │
       └────────▶│    TURN     │◀──────────────┘
                 │   Server    │
                 └─────────────┘
                        │
              ┌─────────┴─────────┐
              │  Media (encrypted) │
              │   Peer-to-Peer    │
              └───────────────────┘
```

For SFU topology:
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client A  │────▶│     SFU     │◀────│   Client B  │
│             │◀────│  (mediasoup)│────▶│             │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │   Client C   │
                    └─────────────┘
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP/WS port | `3000` |
| `REDIS_URL` | Redis connection | `redis://localhost:6379` |
| `LOG_LEVEL` | Logging level | `info` |
| `CORS_ORIGINS` | Allowed origins | `*` |
| `JWT_SECRET` | JWT signing key | required |
