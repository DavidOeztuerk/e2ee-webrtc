# SFU Integration Guide

This guide covers how to use E2EE with Selective Forwarding Units (SFUs) for multi-party video calls.

## Overview

In SFU architecture, media flows through a central server that forwards streams to participants. With E2EE, the SFU sees only encrypted data - it cannot access the actual video/audio content.

```
┌─────────┐     Encrypted      ┌─────────┐     Encrypted      ┌─────────┐
│  Alice  │ ─────────────────► │   SFU   │ ─────────────────► │   Bob   │
│         │ ◄───────────────── │         │ ◄───────────────── │         │
└─────────┘                    └─────────┘                    └─────────┘
     │                              │                              │
     │         Encrypted            │         Encrypted            │
     └──────────────────────────────┴──────────────────────────────┘
                                    │
                                    ▼
                              ┌─────────┐
                              │ Charlie │
                              └─────────┘
```

## Sender Keys Protocol

For SFU scenarios, we use the **Sender Keys** protocol where each participant has their own encryption key:

```typescript
import { SenderKeyManager, ParticipantManager } from '@aspect/e2ee-webrtc';

// Initialize managers
const senderKeys = new SenderKeyManager({
  localParticipantId: myUserId,
  keyHistorySize: 5,
});

const participants = new ParticipantManager({
  localParticipantId: myUserId,
});

// Generate your sender key
await senderKeys.generateLocalKey();
```

## Key Distribution via SFU

### Publishing Your Key

```typescript
// When joining a room, publish your key
async function joinRoom(roomId: string) {
  // Generate key if needed
  if (!senderKeys.hasLocalKey()) {
    await senderKeys.generateLocalKey();
  }

  // Export and send via signaling
  const keyData = await senderKeys.exportLocalKey();

  signalingChannel.send({
    type: 'e2ee-sender-key',
    roomId,
    participantId: myUserId,
    generation: senderKeys.getCurrentGeneration(),
    key: arrayBufferToBase64(keyData),
  });
}
```

### Receiving Keys from Others

```typescript
signalingChannel.on('e2ee-sender-key', async (message) => {
  const { participantId, generation, key } = message;

  // Skip if it's our own key
  if (participantId === myUserId) return;

  // Import the key
  const keyData = base64ToArrayBuffer(key);
  await senderKeys.importRemoteKey(participantId, keyData, generation);

  // Update participant status
  participants.updateKeyState(participantId, {
    hasKey: true,
    generation,
  });

  console.log(`Received key from ${participantId}, generation ${generation}`);
});
```

## Attaching Transforms

### For Sending (Your Streams)

```typescript
// Attach encryption to all outgoing tracks
function attachEncryption(peerConnection: RTCPeerConnection) {
  peerConnection.getSenders().forEach(sender => {
    if (sender.track) {
      const transform = senderKeys.createEncryptTransform();
      attachTransformToSender(sender, transform);
    }
  });
}

// Browser-specific attachment
function attachTransformToSender(sender: RTCRtpSender, transform: TransformStream) {
  if ('transform' in sender) {
    // Chrome/Firefox
    (sender as any).transform = transform;
  }
}
```

### For Receiving (Others' Streams)

```typescript
// When a new track is received from the SFU
peerConnection.ontrack = (event) => {
  const { receiver, streams } = event;
  const participantId = getParticipantIdFromStream(streams[0]);

  // Create decryption transform for this participant
  const transform = senderKeys.createDecryptTransform(participantId);
  attachTransformToReceiver(receiver, transform);

  // Add to video element
  videoElement.srcObject = streams[0];
};

function attachTransformToReceiver(receiver: RTCRtpReceiver, transform: TransformStream) {
  if ('transform' in receiver) {
    (receiver as any).transform = transform;
  }
}
```

## Handling Participants

### Participant Joins

```typescript
signalingChannel.on('participant-joined', async ({ participantId }) => {
  // Add to participant manager
  participants.addParticipant(participantId);

  // Re-publish your key to the new participant
  const keyData = await senderKeys.exportLocalKey();
  signalingChannel.sendTo(participantId, {
    type: 'e2ee-sender-key',
    participantId: myUserId,
    generation: senderKeys.getCurrentGeneration(),
    key: arrayBufferToBase64(keyData),
  });
});
```

### Participant Leaves

```typescript
signalingChannel.on('participant-left', ({ participantId }) => {
  // Remove from tracking
  participants.removeParticipant(participantId);

  // Optionally rotate your key (forward secrecy)
  // This ensures the leaving participant can't decrypt future messages
  if (shouldRotateOnLeave) {
    senderKeys.rotateLocalKey();
    broadcastNewKey();
  }
});
```

## Key Rotation in SFU

### Automatic Rotation

```typescript
const senderKeys = new SenderKeyManager({
  localParticipantId: myUserId,
  autoRotate: true,
  rotationIntervalMs: 5 * 60 * 1000, // 5 minutes
});

senderKeys.on('local-key-rotated', async (event) => {
  // Broadcast new key to all participants
  const keyData = await senderKeys.exportLocalKey();

  signalingChannel.broadcast({
    type: 'e2ee-sender-key',
    participantId: myUserId,
    generation: event.generation,
    key: arrayBufferToBase64(keyData),
  });
});
```

### Handling Incoming Rotation

```typescript
// Receiver handles key updates
signalingChannel.on('e2ee-sender-key', async (message) => {
  const { participantId, generation, key } = message;

  // Check if this is a newer generation
  const currentGen = senderKeys.getRemoteKeyGeneration(participantId);
  if (generation <= currentGen) {
    console.log('Ignoring old key generation');
    return;
  }

  // Import new key
  await senderKeys.importRemoteKey(participantId, base64ToArrayBuffer(key), generation);

  // Old frames will still decrypt with key history
  console.log(`Updated key for ${participantId} to generation ${generation}`);
});
```

## mediasoup Integration

```typescript
import { SenderKeyManager } from '@aspect/e2ee-webrtc';

// Create managers
const senderKeys = new SenderKeyManager({ localParticipantId: myUserId });

// When creating a producer (sending)
const producer = await transport.produce({
  track: localVideoTrack,
  // ... other options
});

// Attach E2EE transform
const sendTransform = senderKeys.createEncryptTransform();
attachToSender(producer.rtpSender, sendTransform);

// When creating a consumer (receiving)
const consumer = await transport.consume({
  // ... options
});

const remoteParticipantId = getParticipantId(consumer);
const receiveTransform = senderKeys.createDecryptTransform(remoteParticipantId);
attachToReceiver(consumer.rtpReceiver, receiveTransform);
```

## Livekit Integration

```typescript
import { Room, RoomEvent } from 'livekit-client';
import { SenderKeyManager } from '@aspect/e2ee-webrtc';

const room = new Room();
const senderKeys = new SenderKeyManager({ localParticipantId: myUserId });

// Before connecting
await senderKeys.generateLocalKey();

// Handle local track published
room.on(RoomEvent.LocalTrackPublished, (publication) => {
  const sender = publication.track?.sender;
  if (sender) {
    const transform = senderKeys.createEncryptTransform();
    attachToSender(sender, transform);
  }
});

// Handle remote track subscribed
room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
  const receiver = track.receiver;
  if (receiver) {
    const transform = senderKeys.createDecryptTransform(participant.identity);
    attachToReceiver(receiver, transform);
  }
});
```

## Debugging SFU E2EE

### Check Key Distribution

```typescript
// List all known keys
const keyStatus = senderKeys.getKeyStatus();
console.log('Key Status:', keyStatus);
// {
//   local: { generation: 3, hasKey: true },
//   remote: {
//     'user-456': { generation: 2, hasKey: true },
//     'user-789': { generation: 1, hasKey: true }
//   }
// }
```

### Monitor Frame Processing

```typescript
// Get stats for debugging
const stats = senderKeys.getStats();
console.log('E2EE Stats:', {
  framesEncrypted: stats.framesEncrypted,
  framesDecrypted: stats.framesDecrypted,
  decryptionErrors: stats.decryptionErrors,
  byParticipant: stats.participantStats,
});
```

### Handle Missing Keys

```typescript
senderKeys.on('missing-key', async (event) => {
  console.log(`Missing key for ${event.participantId}, generation ${event.generation}`);

  // Request key resend
  signalingChannel.sendTo(event.participantId, {
    type: 'e2ee-key-request',
    from: myUserId,
    generation: event.generation,
  });
});

// Handle key request
signalingChannel.on('e2ee-key-request', async (request) => {
  const keyData = await senderKeys.exportLocalKey();
  signalingChannel.sendTo(request.from, {
    type: 'e2ee-sender-key',
    participantId: myUserId,
    generation: senderKeys.getCurrentGeneration(),
    key: arrayBufferToBase64(keyData),
  });
});
```

## Performance Considerations

1. **Key Distribution Timing**: Distribute keys before media flows to avoid decryption failures
2. **Key History Size**: Balance between memory usage and rotation smoothness (5-10 is typical)
3. **Rotation Frequency**: More frequent = better forward secrecy, but more signaling overhead
4. **Frame Drop Policy**: Configure whether to drop or pass through unencryptable frames
