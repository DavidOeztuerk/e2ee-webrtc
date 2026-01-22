# Key Management Guide

This guide covers key generation, distribution, rotation, and best practices for E2EE key management.

## Key Generation

### Generating a New Key

```typescript
import { KeyManager } from '@aspect/e2ee-webrtc';

const keyManager = new KeyManager({
  participantId: 'user-123',
  keyHistorySize: 5, // Keep 5 old keys for decryption
});

// Generate a new AES-256-GCM key
await keyManager.generateKey();

// Get the current key for encryption
const encryptionKey = keyManager.getEncryptionKey();
const generation = keyManager.getCurrentGeneration();
```

### Key Properties

- **Algorithm**: AES-GCM with 256-bit keys
- **IV Size**: 12 bytes (96 bits)
- **Auth Tag Size**: 16 bytes (128 bits)
- **Key Generation**: Incremental counter (0-255)

## Key Distribution

Keys must be distributed securely through your signaling channel. **Never send keys in plaintext over insecure channels.**

### Export/Import Keys

```typescript
// Sender: Export key for distribution
const keyData = await keyManager.exportKey();

// Send via secure signaling channel
signalingChannel.send({
  type: 'e2ee-key',
  participantId: 'user-123',
  generation: keyManager.getCurrentGeneration(),
  key: arrayBufferToBase64(keyData),
});

// Receiver: Import the key
signalingChannel.on('e2ee-key', async (message) => {
  const keyData = base64ToArrayBuffer(message.key);
  await keyManager.importKey(keyData, message.generation);
});
```

### Secure Key Exchange Options

1. **Pre-shared Keys**: Exchange keys out-of-band before the call
2. **SAS Verification**: Display Short Authentication Strings for manual verification
3. **Identity Keys**: Use long-term identity keys to authenticate session keys
4. **MLS Protocol**: For large groups, consider MLS for scalable key management

## Key Rotation

Key rotation provides forward secrecy - if a key is compromised, only data encrypted with that specific key is at risk.

### Automatic Rotation

```typescript
const keyManager = new KeyManager({
  participantId: 'user-123',
  autoRotate: true,
  rotationIntervalMs: 5 * 60 * 1000, // Rotate every 5 minutes
});

// Listen for rotation events
keyManager.on('key-rotated', async (event) => {
  console.log(`Key rotated to generation ${event.generation}`);

  // Distribute new key
  const keyData = await keyManager.exportKey();
  distributeKey(keyData, event.generation);
});
```

### Manual Rotation

```typescript
// Rotate key manually
await keyManager.rotateKey();

// Export and distribute the new key
const newKey = await keyManager.exportKey();
await distributeKey(newKey, keyManager.getCurrentGeneration());
```

### Handling Key Rotation on Receivers

```typescript
// Keep old keys for decryption during rotation window
const keyManager = new KeyManager({
  keyHistorySize: 5, // Keep last 5 keys
});

// When receiving a frame with an old generation
keyManager.on('decryption-with-old-key', (event) => {
  console.log(`Decrypted with old key generation ${event.generation}`);
});

// When unable to decrypt (key missing)
keyManager.on('decryption-failed', (event) => {
  console.log(`Missing key for generation ${event.generation}`);
  // Request key resend from participant
  requestKeyResend(event.participantId, event.generation);
});
```

## Multi-Party Key Management

For calls with multiple participants, use the SenderKeyManager:

```typescript
import { SenderKeyManager } from '@aspect/e2ee-webrtc';

const senderKeys = new SenderKeyManager({
  localParticipantId: 'user-123',
});

// Generate your own sender key
await senderKeys.generateLocalKey();

// Distribute your key to all participants
const myKey = await senderKeys.exportLocalKey();
broadcastKey(myKey);

// Import keys from other participants
senderKeys.on('participant-key-received', (participantId, keyData) => {
  await senderKeys.importRemoteKey(participantId, keyData);
});

// Get the right key for encryption/decryption
const encryptKey = senderKeys.getEncryptionKey(); // Your key
const decryptKey = senderKeys.getDecryptionKey(participantId, generation); // Their key
```

## Security Best Practices

### Do's

- ✅ Rotate keys regularly (every 5-15 minutes)
- ✅ Keep key history for smooth rotation transitions
- ✅ Verify participant identity before accepting keys
- ✅ Use secure signaling channels for key distribution
- ✅ Zero out keys in memory after use
- ✅ Log key rotation events for debugging

### Don'ts

- ❌ Never log or store actual key material
- ❌ Never send keys over unencrypted channels
- ❌ Never reuse IVs with the same key
- ❌ Don't skip key verification in production
- ❌ Don't use weak random number generators

## Key Verification

For high-security applications, verify keys out-of-band:

```typescript
import { generateSAS } from '@aspect/e2ee-webrtc';

// Generate Short Authentication String from shared key
const sas = await generateSAS(sharedKeyData);
// Returns something like: "3847-1592-8264"

// Display to both users for verbal/visual verification
displaySAS(sas);

// If SAS matches, keys are verified
// If not, potential MITM attack - abort connection
```

## Troubleshooting

### "No key for generation X"

This means frames are being received with a key generation that hasn't been distributed yet.

**Solutions:**
1. Ensure key distribution happens before media flows
2. Increase `keyHistorySize` to handle network delays
3. Implement key request/resend mechanism

### "Decryption failed"

Possible causes:
1. Key mismatch between sender and receiver
2. Frame corruption during transmission
3. IV reuse (should never happen with proper implementation)

**Debug:**
```typescript
keyManager.on('decryption-error', (error) => {
  console.log('Generation:', error.generation);
  console.log('Frame size:', error.frameSize);
  console.log('Error:', error.message);
});
```

### Key Sync Issues

If participants get out of sync:

```typescript
// Request full key resync
signalingChannel.send({
  type: 'key-sync-request',
  participantId: localParticipantId,
});

// Handle sync request
signalingChannel.on('key-sync-request', async (request) => {
  const allKeys = await keyManager.exportAllKeys();
  signalingChannel.send({
    type: 'key-sync-response',
    to: request.participantId,
    keys: allKeys,
  });
});
```
