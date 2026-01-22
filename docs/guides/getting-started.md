# Getting Started with @aspect/e2ee-webrtc

This guide will help you integrate end-to-end encryption into your WebRTC application.

## Installation

```bash
npm install @aspect/e2ee-webrtc
# or
yarn add @aspect/e2ee-webrtc
# or
pnpm add @aspect/e2ee-webrtc
```

## Quick Start

### 1. Basic Setup

```typescript
import { E2EEManager, detectBrowser } from '@aspect/e2ee-webrtc';

// Detect browser capabilities
const browser = detectBrowser();
console.log(`Browser: ${browser.name}, E2EE Support: ${browser.supportsE2EE}`);

// Create E2EE manager
const e2ee = new E2EEManager({
  participantId: 'user-123',
  debug: true,
});

// Initialize
await e2ee.initialize();
```

### 2. Generate and Share Keys

```typescript
// Generate a new encryption key
const keyData = await e2ee.generateKey();

// Export key for sharing (via your signaling channel)
const exportedKey = await e2ee.exportKey();

// On the receiving end, import the shared key
await e2ee.importKey(receivedKeyData);
```

### 3. Attach to WebRTC Connection

```typescript
// When you create a peer connection
const peerConnection = new RTCPeerConnection(config);

// After adding tracks, attach E2EE transforms
peerConnection.getSenders().forEach(sender => {
  e2ee.attachToSender(sender);
});

peerConnection.getReceivers().forEach(receiver => {
  e2ee.attachToReceiver(receiver);
});
```

### 4. Handle Key Rotation

```typescript
// Rotate keys periodically for forward secrecy
setInterval(async () => {
  await e2ee.rotateKey();

  // Distribute new key via signaling
  const newKey = await e2ee.exportKey();
  signalingChannel.send({ type: 'key-update', key: newKey });
}, 5 * 60 * 1000); // Every 5 minutes
```

## Browser Support

| Browser | Minimum Version | API Used |
|---------|-----------------|----------|
| Chrome | 86+ | Insertable Streams |
| Edge | 86+ | Insertable Streams |
| Safari | 15.4+ | RTCRtpScriptTransform |
| Firefox | 117+ | Insertable Streams (experimental) |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Your Application                      │
├─────────────────────────────────────────────────────────┤
│                    E2EEManager                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ KeyManager  │  │StateMachine │  │BrowserAdapter│    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
├─────────────────────────────────────────────────────────┤
│                  FrameProcessor                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Encrypt Frame  →  Add Header  →  Send          │   │
│  │  Receive  →  Extract Header  →  Decrypt Frame   │   │
│  └─────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│                  WebRTC APIs                            │
│  RTCRtpSender.transform / RTCRtpScriptTransform        │
└─────────────────────────────────────────────────────────┘
```

## Frame Format

Each encrypted frame has the following structure:

```
┌────────────┬──────────────┬─────────────────────────────┐
│ Generation │     IV       │    Ciphertext + AuthTag     │
│  (1 byte)  │  (12 bytes)  │      (variable + 16)        │
└────────────┴──────────────┴─────────────────────────────┘
```

- **Generation**: Key generation identifier for key rotation support
- **IV**: Initialization vector for AES-GCM (unique per frame)
- **Ciphertext**: Encrypted frame data
- **AuthTag**: 16-byte authentication tag for integrity verification

## Next Steps

- [API Reference](./api-reference.md)
- [Key Management Guide](./key-management.md)
- [Multi-Party Calls (SFU)](./sfu-integration.md)
- [Deployment Guide](./deployment.md)
