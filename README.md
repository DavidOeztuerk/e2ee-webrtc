# @aspect/e2ee-webrtc

<div align="center">

![E2EE WebRTC](https://img.shields.io/badge/E2EE-WebRTC-blue?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=for-the-badge&logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
[![Tests](https://img.shields.io/github/actions/workflow/status/DavidOeztuerk/e2ee-webrtc/ci.yml?style=for-the-badge&label=Tests)](https://github.com/DavidOeztuerk/e2ee-webrtc/actions)

**Framework-agnostic End-to-End Encrypted WebRTC library**

[Documentation](https://davidoeztuerk.github.io/e2ee-webrtc) · [Live Demo](https://davidoeztuerk.github.io/e2ee-webrtc/demo) · [API Reference](https://davidoeztuerk.github.io/e2ee-webrtc/api)

</div>

---

## ✨ Features

- 🔐 **True End-to-End Encryption** - AES-GCM-256 encryption with unique IVs per frame
- 🌐 **Cross-Browser Support** - Chrome (Insertable Streams) + Safari (Script Transform)
- 🚀 **Framework Agnostic** - Works with React, Vue, Angular, Svelte, or vanilla JS
- 🏠 **Digital Sovereignty** - Self-host on your own infrastructure
- 🔄 **Key Rotation** - Automatic key rotation with configurable intervals
- 👥 **Multi-Party Support** - SFU-ready with Sender Keys encryption
- 🛡️ **Post-Quantum Ready** - Hybrid Kyber + ECDH encryption (coming soon)
- 📊 **Visual Debugging** - Built-in encryption status indicators
- 🧪 **Fully Tested** - Comprehensive unit, integration, and E2E tests

## 📦 Installation

```bash
npm install @aspect/e2ee-webrtc
# or
yarn add @aspect/e2ee-webrtc
# or
pnpm add @aspect/e2ee-webrtc
```

## 🚀 Quick Start

```typescript
import {
  isE2EESupported,
  detectCapabilities,
  KeyManager,
  encryptFrame,
  decryptFrame,
} from '@aspect/e2ee-webrtc';

// 1. Check browser support
if (!isE2EESupported()) {
  console.warn('E2EE not supported in this browser');
  return;
}

// 2. Detect capabilities
const capabilities = detectCapabilities();
console.log(`Using ${capabilities.e2eeMethod} for E2EE`);

// 3. Create key manager
const keyManager = new KeyManager({
  keyHistorySize: 5,
  autoRotate: true,
  rotationIntervalMs: 30000, // 30 seconds
});

// 4. Generate encryption key
await keyManager.generateKey();

// 5. Listen for key events
keyManager.on('key-rotated', (data) => {
  console.log(`Key rotated to generation ${data.generation}`);
  // Send new key to peer via signaling
});
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    @aspect/e2ee-webrtc                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │    Core      │  │   Browser    │  │     SFU      │          │
│  │   Crypto     │  │  Detection   │  │   Support    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌──────────────────────────────────────────────────┐          │
│  │              Unified E2EE API                     │          │
│  └──────────────────────────────────────────────────┘          │
│         │                                                       │
│         ▼                                                       │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │   Chrome     │  │   Safari     │                            │
│  │   Worker     │  │   Worker     │                            │
│  │ (Insertable  │  │  (Script     │                            │
│  │  Streams)    │  │  Transform)  │                            │
│  └──────────────┘  └──────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 🔧 Deployment Options

### Option 1: Self-Hosted (On-Premise)

Full control over your data and infrastructure:

```typescript
import { KeyManager, detectCapabilities } from '@aspect/e2ee-webrtc';

const keyManager = new KeyManager({
  keyHistorySize: 5,
});

// Your own signaling server
const signaling = new WebSocket('wss://your-server.com/signaling');

// Exchange keys through your infrastructure
signaling.onmessage = async (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'key-exchange') {
    await keyManager.importKey(message.keyData, message.generation);
  }
};
```

### Option 2: Managed Cloud

Quick setup with our managed infrastructure:

```typescript
// Coming soon - managed SFU service
```

### Option 3: Hybrid

Best of both worlds:

```typescript
// Your signaling + our TURN/SFU
// Coming soon
```

## 📖 API Reference

### Browser Detection

```typescript
import {
  detectBrowser,
  detectCapabilities,
  isE2EESupported,
  getWorkerUrl
} from '@aspect/e2ee-webrtc';

// Detect browser
const { browser, version } = detectBrowser();
// { browser: 'chrome', version: '120.0.0.0' }

// Get full capabilities
const caps = detectCapabilities();
// {
//   browser: 'chrome',
//   version: '120.0.0.0',
//   e2eeMethod: 'insertable-streams',
//   supportsInsertableStreams: true,
//   supportsScriptTransform: false,
//   supportsWorkers: true,
//   supportsSharedArrayBuffer: true,
//   supportsWasm: true,
// }

// Check E2EE support
if (isE2EESupported()) {
  const workerUrl = getWorkerUrl(caps.e2eeMethod);
  const worker = new Worker(workerUrl, { type: 'module' });
}
```

### Cryptographic Operations

```typescript
import {
  generateEncryptionKey,
  encryptFrame,
  decryptFrame,
  generateKeyPair,
  deriveSharedSecret,
  computeFingerprint,
  formatFingerprint,
} from '@aspect/e2ee-webrtc';

// Generate AES-GCM-256 key
const encryptionKey = await generateEncryptionKey();

// Encrypt a frame
const encrypted = await encryptFrame(frameData, encryptionKey, generation);
// { generation: 1, iv: Uint8Array(12), ciphertext: Uint8Array }

// Decrypt a frame
const decrypted = await decryptFrame(encrypted, encryptionKey);

// ECDH Key Exchange
const aliceKeyPair = await generateKeyPair();
const bobKeyPair = await generateKeyPair();

const aliceSharedSecret = await deriveSharedSecret(
  aliceKeyPair.privateKey,
  bobKeyPair.publicKey
);

// Both get the same 32-byte shared secret!

// Fingerprint for verification
const fingerprint = await computeFingerprint(aliceKeyPair.publicKey);
const formatted = formatFingerprint(fingerprint);
// "AB:CD:EF:12:34:56:78:9A:BC:DE:F0:..."
```

### Key Management

```typescript
import { KeyManager } from '@aspect/e2ee-webrtc';

const keyManager = new KeyManager({
  keyHistorySize: 5,      // Keep 5 previous keys for in-flight frames
  autoRotate: true,       // Automatically rotate keys
  rotationIntervalMs: 30000, // Every 30 seconds
});

// Generate initial key
await keyManager.generateKey();

// Events
keyManager.on('key-generated', (data) => {
  console.log('New key generation:', data.generation);
});

keyManager.on('key-rotated', (data) => {
  // Send new key to peers
  sendKeyToPeers(await keyManager.exportCurrentKey(), data.generation);
});

// Get key for decryption (handles key history)
const key = keyManager.getKeyForGeneration(frameGeneration);

// Fingerprint for verification
const fingerprint = await keyManager.getFormattedFingerprint();
// "AB:CD:EF:12:34:56:78:9A:..."

// Cleanup
keyManager.destroy();
```

## 🔒 Security

### Frame Encryption Format

```
┌─────────────┬──────────────┬─────────────────────────────────┐
│ Generation  │     IV       │    Ciphertext + Auth Tag        │
│  (1 byte)   │  (12 bytes)  │      (variable + 16 bytes)      │
└─────────────┴──────────────┴─────────────────────────────────┘
```

- **Generation**: Key version (0-255, wraps around)
- **IV**: Unique 12-byte nonce per frame
- **Ciphertext**: AES-GCM encrypted payload
- **Auth Tag**: 16-byte authentication tag

### Security Features

- ✅ AES-GCM-256 authenticated encryption
- ✅ Unique IV per frame (never reused)
- ✅ Constant-time comparison (timing attack resistant)
- ✅ Key zeroization (best-effort memory clearing)
- ✅ Non-extractable private keys
- ✅ Key fingerprints for verification
- ✅ Forward secrecy with key rotation
- 🔜 Post-quantum hybrid encryption (Kyber + ECDH)
- 🔜 Replay attack protection

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- tests/unit/crypto/aes-gcm.test.ts

# Run E2E tests
npm run test:e2e
```

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) first.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests for your changes
4. Ensure all tests pass (`npm test`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- WebRTC Insertable Streams specification
- Safari RTCRtpScriptTransform API
- Web Crypto API

---

<div align="center">

Made with ❤️ by [David Öztuerk](https://github.com/DavidOeztuerk)

</div>
