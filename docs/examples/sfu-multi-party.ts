/**
 * SFU Multi-Party E2EE Example
 *
 * This example shows how to set up E2EE for a multi-party video call
 * using an SFU (Selective Forwarding Unit) with Sender Keys protocol.
 */

import {
  SenderKeyManager,
  ParticipantManager,
  detectBrowser,
  type KeyGeneration,
} from '@aspect/e2ee-webrtc';

// Types
interface Participant {
  id: string;
  name: string;
  videoTrack?: MediaStreamTrack;
  audioTrack?: MediaStreamTrack;
  e2eeStatus: 'pending' | 'active' | 'failed';
}

interface SignalingMessage {
  type: string;
  from: string;
  to?: string;
  [key: string]: unknown;
}

// Configuration
const SFU_URL = 'wss://sfu.example.com';
const ROOM_ID = 'meeting-123';

// State
const participants = new Map<string, Participant>();
let localParticipantId: string;
let senderKeys: SenderKeyManager;
let participantManager: ParticipantManager;
let signalingChannel: WebSocket;
let localStream: MediaStream;

/**
 * Initialize the application
 */
async function init(): Promise<void> {
  // Check browser support
  const browser = detectBrowser();
  if (!browser.supportsE2EE) {
    showError(`E2EE not supported in ${browser.name}`);
    return;
  }

  // Generate participant ID
  localParticipantId = generateParticipantId();

  // Initialize E2EE managers
  senderKeys = new SenderKeyManager({
    localParticipantId,
    keyHistorySize: 5,
    debug: true,
  });

  participantManager = new ParticipantManager({
    localParticipantId,
  });

  // Set up event handlers
  setupE2EEEventHandlers();

  // Get local media
  await getLocalMedia();

  // Generate local encryption key
  await senderKeys.generateLocalKey();

  // Connect to SFU
  await connectToSFU();

  console.log('Initialized with participant ID:', localParticipantId);
}

/**
 * Set up E2EE event handlers
 */
function setupE2EEEventHandlers(): void {
  // Key rotated
  senderKeys.on('local-key-rotated', async (event) => {
    console.log(`Local key rotated to generation ${event.generation}`);
    await broadcastKey();
  });

  // Missing key for decryption
  senderKeys.on('missing-key', (event) => {
    console.warn(`Missing key for ${event.participantId}, generation ${event.generation}`);
    requestKeyResend(event.participantId);
  });

  // Decryption error
  senderKeys.on('decryption-error', (event) => {
    console.error(`Decryption error for ${event.participantId}:`, event.error);
    updateParticipantE2EEStatus(event.participantId, 'failed');
  });

  // Participant key received
  participantManager.on('participant-key-updated', (participantId) => {
    updateParticipantE2EEStatus(participantId, 'active');
  });
}

/**
 * Connect to SFU signaling
 */
async function connectToSFU(): Promise<void> {
  return new Promise((resolve, reject) => {
    signalingChannel = new WebSocket(`${SFU_URL}?room=${ROOM_ID}`);

    signalingChannel.onopen = () => {
      // Join the room
      send({
        type: 'join',
        from: localParticipantId,
        name: getDisplayName(),
      });
      resolve();
    };

    signalingChannel.onerror = reject;

    signalingChannel.onmessage = async (event) => {
      const message = JSON.parse(event.data) as SignalingMessage;
      await handleSignalingMessage(message);
    };

    signalingChannel.onclose = () => {
      console.log('Disconnected from SFU');
    };
  });
}

/**
 * Handle signaling messages
 */
async function handleSignalingMessage(message: SignalingMessage): Promise<void> {
  switch (message.type) {
    case 'joined':
      await handleJoined(message);
      break;

    case 'participant-joined':
      await handleParticipantJoined(message);
      break;

    case 'participant-left':
      handleParticipantLeft(message);
      break;

    case 'e2ee-key':
      await handleE2EEKey(message);
      break;

    case 'e2ee-key-request':
      await handleKeyRequest(message);
      break;

    case 'track-published':
      await handleTrackPublished(message);
      break;

    case 'offer':
      await handleOffer(message);
      break;

    case 'answer':
      await handleAnswer(message);
      break;

    case 'ice-candidate':
      await handleIceCandidate(message);
      break;
  }
}

/**
 * Handle successful room join
 */
async function handleJoined(message: SignalingMessage): Promise<void> {
  console.log('Joined room');

  // Get existing participants
  const existingParticipants = message.participants as Array<{ id: string; name: string }>;

  for (const p of existingParticipants) {
    addParticipant(p.id, p.name);
  }

  // Broadcast our E2EE key to all participants
  await broadcastKey();

  // Publish local tracks
  await publishLocalTracks();
}

/**
 * Handle new participant joining
 */
async function handleParticipantJoined(message: SignalingMessage): Promise<void> {
  const participantId = message.participantId as string;
  const name = message.name as string;

  addParticipant(participantId, name);

  // Send our key to the new participant
  await sendKeyTo(participantId);
}

/**
 * Handle participant leaving
 */
function handleParticipantLeft(message: SignalingMessage): void {
  const participantId = message.participantId as string;

  removeParticipant(participantId);

  // Optionally rotate key for forward secrecy
  // This ensures the leaving participant can't decrypt future messages
  scheduleKeyRotation();
}

/**
 * Handle incoming E2EE key
 */
async function handleE2EEKey(message: SignalingMessage): Promise<void> {
  const participantId = message.from;
  const keyBase64 = message.key as string;
  const generation = message.generation as KeyGeneration;

  // Decode key
  const keyData = base64ToArrayBuffer(keyBase64);

  // Import into sender key manager
  await senderKeys.importRemoteKey(participantId, keyData, generation);

  // Update participant manager
  participantManager.updateKeyState(participantId, {
    hasKey: true,
    generation,
  });

  console.log(`Received E2EE key from ${participantId}, generation ${generation}`);
}

/**
 * Handle key resend request
 */
async function handleKeyRequest(message: SignalingMessage): Promise<void> {
  console.log(`Key requested by ${message.from}`);
  await sendKeyTo(message.from);
}

/**
 * Handle track published by another participant
 */
async function handleTrackPublished(message: SignalingMessage): Promise<void> {
  const participantId = message.from;
  const trackId = message.trackId as string;
  const trackType = message.trackType as 'video' | 'audio';

  // Create a consumer for this track
  // (Implementation depends on your SFU)
  await subscribeToTrack(participantId, trackId, trackType);
}

/**
 * Subscribe to a remote track with E2EE decryption
 */
async function subscribeToTrack(
  participantId: string,
  trackId: string,
  trackType: 'video' | 'audio'
): Promise<void> {
  // This would be implemented based on your SFU
  // Example with generic RTCPeerConnection:

  // When you receive the track via SFU:
  // 1. Create decryption transform for this participant
  // 2. Attach to receiver

  // Pseudo-code:
  // const receiver = getReceiverForTrack(trackId);
  // const decryptTransform = senderKeys.createDecryptTransform(participantId);
  // attachToReceiver(receiver, decryptTransform);

  console.log(`Subscribed to ${trackType} track from ${participantId}`);
}

/**
 * Publish local tracks with E2EE encryption
 */
async function publishLocalTracks(): Promise<void> {
  // Publish each track
  for (const track of localStream.getTracks()) {
    // When publishing, attach encryption transform
    // (Implementation depends on your SFU)

    // Pseudo-code:
    // const sender = await publishTrack(track);
    // const encryptTransform = senderKeys.createEncryptTransform();
    // attachToSender(sender, encryptTransform);

    // Notify others
    send({
      type: 'track-published',
      from: localParticipantId,
      trackId: track.id,
      trackType: track.kind,
    });
  }
}

/**
 * Broadcast E2EE key to all participants
 */
async function broadcastKey(): Promise<void> {
  const keyData = await senderKeys.exportLocalKey();
  const keyBase64 = arrayBufferToBase64(keyData);

  send({
    type: 'e2ee-key',
    from: localParticipantId,
    key: keyBase64,
    generation: senderKeys.getCurrentGeneration(),
  });
}

/**
 * Send E2EE key to specific participant
 */
async function sendKeyTo(participantId: string): Promise<void> {
  const keyData = await senderKeys.exportLocalKey();
  const keyBase64 = arrayBufferToBase64(keyData);

  send({
    type: 'e2ee-key',
    from: localParticipantId,
    to: participantId,
    key: keyBase64,
    generation: senderKeys.getCurrentGeneration(),
  });
}

/**
 * Request key resend from participant
 */
function requestKeyResend(participantId: string): void {
  send({
    type: 'e2ee-key-request',
    from: localParticipantId,
    to: participantId,
  });
}

/**
 * Schedule key rotation for forward secrecy
 */
let rotationTimeout: ReturnType<typeof setTimeout> | null = null;

function scheduleKeyRotation(): void {
  // Debounce to avoid rotating multiple times when many participants leave
  if (rotationTimeout) {
    clearTimeout(rotationTimeout);
  }

  rotationTimeout = setTimeout(async () => {
    console.log('Rotating key for forward secrecy');
    await senderKeys.rotateLocalKey();
    // Key broadcast is handled by the 'local-key-rotated' event
  }, 5000);
}

// Participant management
function addParticipant(id: string, name: string): void {
  participants.set(id, {
    id,
    name,
    e2eeStatus: 'pending',
  });
  participantManager.addParticipant(id, { role: 'participant' });
  renderParticipants();
}

function removeParticipant(id: string): void {
  participants.delete(id);
  participantManager.removeParticipant(id);
  renderParticipants();
}

function updateParticipantE2EEStatus(id: string, status: 'pending' | 'active' | 'failed'): void {
  const participant = participants.get(id);
  if (participant) {
    participant.e2eeStatus = status;
    renderParticipants();
  }
}

// UI helpers
function renderParticipants(): void {
  const container = document.getElementById('participants');
  if (!container) return;

  container.innerHTML = '';

  for (const [, participant] of participants) {
    const div = document.createElement('div');
    div.className = `participant e2ee-${participant.e2eeStatus}`;
    div.innerHTML = `
      <video autoplay playsinline></video>
      <div class="name">${participant.name}</div>
      <div class="e2ee-badge">${getE2EEBadge(participant.e2eeStatus)}</div>
    `;
    container.appendChild(div);
  }
}

function getE2EEBadge(status: string): string {
  switch (status) {
    case 'active':
      return '🔒 Encrypted';
    case 'pending':
      return '⏳ Connecting...';
    case 'failed':
      return '⚠️ Not encrypted';
    default:
      return '';
  }
}

function showError(message: string): void {
  console.error(message);
  const errorDiv = document.getElementById('error');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
  }
}

// Utility functions
function send(message: object): void {
  if (signalingChannel?.readyState === WebSocket.OPEN) {
    signalingChannel.send(JSON.stringify(message));
  }
}

function generateParticipantId(): string {
  return `user-${Math.random().toString(36).substr(2, 9)}`;
}

function getDisplayName(): string {
  return localStorage.getItem('displayName') || `User ${localParticipantId.slice(-4)}`;
}

async function getLocalMedia(): Promise<void> {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });

  // Display local video
  const localVideo = document.getElementById('local-video') as HTMLVideoElement;
  if (localVideo) {
    localVideo.srcObject = localStream;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Placeholder handlers (implement based on your SFU)
async function handleOffer(message: SignalingMessage): Promise<void> {
  console.log('Handle offer from', message.from);
}

async function handleAnswer(message: SignalingMessage): Promise<void> {
  console.log('Handle answer from', message.from);
}

async function handleIceCandidate(message: SignalingMessage): Promise<void> {
  console.log('Handle ICE candidate from', message.from);
}

// Start application
document.addEventListener('DOMContentLoaded', init);

// Cleanup
window.addEventListener('beforeunload', () => {
  signalingChannel?.close();
  localStream?.getTracks().forEach((track) => track.stop());
});
