/**
 * Basic P2P E2EE Example
 *
 * This example shows how to set up E2EE for a simple peer-to-peer video call.
 */

import { E2EEManager, detectBrowser } from '@aspect/e2ee-webrtc';

// Configuration
const SIGNALING_URL = 'wss://signaling.example.com';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls: 'turn:turn.example.com:3478',
    username: 'user',
    credential: 'pass',
  },
];

// State
let localStream: MediaStream | null = null;
let peerConnection: RTCPeerConnection | null = null;
let e2ee: E2EEManager | null = null;
let signalingChannel: WebSocket | null = null;

/**
 * Initialize E2EE
 */
async function initializeE2EE(participantId: string): Promise<void> {
  // Check browser support
  const browser = detectBrowser();
  if (!browser.supportsE2EE) {
    throw new Error(`E2EE not supported in ${browser.name} ${browser.version}`);
  }

  // Create E2EE manager
  e2ee = new E2EEManager({
    participantId,
    debug: true,
  });

  await e2ee.initialize();

  // Generate encryption key
  await e2ee.generateKey();

  console.log('E2EE initialized');
}

/**
 * Connect to signaling server
 */
function connectSignaling(roomId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    signalingChannel = new WebSocket(`${SIGNALING_URL}?room=${roomId}`);

    signalingChannel.onopen = () => {
      console.log('Connected to signaling server');
      resolve();
    };

    signalingChannel.onerror = (error) => {
      reject(error);
    };

    signalingChannel.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      await handleSignalingMessage(message);
    };
  });
}

/**
 * Handle signaling messages
 */
async function handleSignalingMessage(message: {
  type: string;
  [key: string]: unknown;
}): Promise<void> {
  switch (message.type) {
    case 'offer':
      await handleOffer(message as RTCSessionDescriptionInit);
      break;

    case 'answer':
      await handleAnswer(message as RTCSessionDescriptionInit);
      break;

    case 'ice-candidate':
      await handleIceCandidate(message.candidate as RTCIceCandidateInit);
      break;

    case 'e2ee-key':
      await handleE2EEKey(message.key as string, message.generation as number);
      break;

    case 'peer-joined':
      await initiateCall();
      break;
  }
}

/**
 * Get local media
 */
async function getLocalMedia(): Promise<MediaStream> {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });

  // Display local video
  const localVideo = document.getElementById('local-video') as HTMLVideoElement;
  localVideo.srcObject = localStream;

  return localStream;
}

/**
 * Create peer connection with E2EE
 */
async function createPeerConnection(): Promise<RTCPeerConnection> {
  peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection!.addTrack(track, localStream!);
    });
  }

  // Attach E2EE to senders
  peerConnection.getSenders().forEach((sender) => {
    if (sender.track && e2ee) {
      e2ee.attachToSender(sender);
    }
  });

  // Handle incoming tracks
  peerConnection.ontrack = (event) => {
    // Attach E2EE decryption
    if (e2ee) {
      e2ee.attachToReceiver(event.receiver);
    }

    // Display remote video
    const remoteVideo = document.getElementById('remote-video') as HTMLVideoElement;
    remoteVideo.srcObject = event.streams[0];
  };

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignaling({
        type: 'ice-candidate',
        candidate: event.candidate,
      });
    }
  };

  // Handle connection state changes
  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state:', peerConnection?.connectionState);

    if (peerConnection?.connectionState === 'connected') {
      updateStatus('Connected with E2EE');
    }
  };

  return peerConnection;
}

/**
 * Initiate call (create offer)
 */
async function initiateCall(): Promise<void> {
  if (!peerConnection) {
    await createPeerConnection();
  }

  // Send E2EE key first
  await sendE2EEKey();

  // Create and send offer
  const offer = await peerConnection!.createOffer();
  await peerConnection!.setLocalDescription(offer);

  sendSignaling({
    type: 'offer',
    sdp: offer.sdp,
  });
}

/**
 * Handle incoming offer
 */
async function handleOffer(offer: RTCSessionDescriptionInit): Promise<void> {
  if (!peerConnection) {
    await createPeerConnection();
  }

  await peerConnection!.setRemoteDescription(offer);

  // Send our E2EE key
  await sendE2EEKey();

  // Create and send answer
  const answer = await peerConnection!.createAnswer();
  await peerConnection!.setLocalDescription(answer);

  sendSignaling({
    type: 'answer',
    sdp: answer.sdp,
  });
}

/**
 * Handle incoming answer
 */
async function handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
  await peerConnection?.setRemoteDescription(answer);
}

/**
 * Handle ICE candidate
 */
async function handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
  await peerConnection?.addIceCandidate(candidate);
}

/**
 * Send E2EE key via signaling
 */
async function sendE2EEKey(): Promise<void> {
  if (!e2ee) return;

  const keyData = await e2ee.exportKey();
  const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(keyData)));

  sendSignaling({
    type: 'e2ee-key',
    key: keyBase64,
    generation: e2ee.getCurrentGeneration(),
  });
}

/**
 * Handle incoming E2EE key
 */
async function handleE2EEKey(keyBase64: string, generation: number): Promise<void> {
  if (!e2ee) return;

  const keyData = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0)).buffer;
  await e2ee.importKey(keyData, generation);

  console.log(`Imported E2EE key, generation ${generation}`);
  updateStatus('E2EE key exchanged');
}

/**
 * Send message via signaling channel
 */
function sendSignaling(message: object): void {
  if (signalingChannel?.readyState === WebSocket.OPEN) {
    signalingChannel.send(JSON.stringify(message));
  }
}

/**
 * Update UI status
 */
function updateStatus(status: string): void {
  const statusElement = document.getElementById('status');
  if (statusElement) {
    statusElement.textContent = status;
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const participantId = `user-${Math.random().toString(36).substr(2, 9)}`;
  const roomId = new URLSearchParams(window.location.search).get('room') || 'default-room';

  try {
    updateStatus('Initializing...');

    // Initialize E2EE
    await initializeE2EE(participantId);

    // Get local media
    await getLocalMedia();

    // Connect to signaling
    await connectSignaling(roomId);

    // Announce presence
    sendSignaling({ type: 'join', participantId });

    updateStatus('Waiting for peer...');
  } catch (error) {
    console.error('Error:', error);
    updateStatus(`Error: ${(error as Error).message}`);
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  peerConnection?.close();
  signalingChannel?.close();
  localStream?.getTracks().forEach((track) => track.stop());
});
