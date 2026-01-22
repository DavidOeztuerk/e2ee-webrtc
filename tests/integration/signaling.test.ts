/**
 * @module tests/integration/signaling
 * Real integration tests for signaling server
 *
 * These tests require Docker services to be running:
 * - Redis on port 6379
 * - Signaling server on port 3001
 *
 * Run with: docker-compose -f docker-compose.test.yml up
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';

// Skip if not in CI or Docker environment
const SKIP_INTEGRATION = !process.env.CI && !process.env.INTEGRATION_TESTS;

const SIGNALING_URL = process.env.SIGNALING_URL || 'ws://localhost:3001';
const HEALTH_URL = SIGNALING_URL.replace('ws://', 'http://').replace('wss://', 'https://') + '/health';

interface SignalingMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Helper to create a WebSocket client
 */
function createClient(roomId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${SIGNALING_URL}?room=${roomId}`);

    ws.on('open', () => resolve(ws));
    ws.on('error', reject);

    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });
}

/**
 * Helper to wait for a specific message type
 */
function waitForMessage(ws: WebSocket, type: string, timeout = 5000): Promise<SignalingMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for message type: ${type}`));
    }, timeout);

    const handler = (data: WebSocket.Data) => {
      const message = JSON.parse(data.toString()) as SignalingMessage;
      if (message.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(message);
      }
    };

    ws.on('message', handler);
  });
}

/**
 * Helper to send and receive
 */
function sendMessage(ws: WebSocket, message: object): void {
  ws.send(JSON.stringify(message));
}

describe.skipIf(SKIP_INTEGRATION)('Signaling Server Integration', () => {
  let client1: WebSocket | null = null;
  let client2: WebSocket | null = null;

  beforeAll(async () => {
    // Check if signaling server is running
    try {
      const response = await fetch(HEALTH_URL);
      if (!response.ok) {
        throw new Error('Signaling server not healthy');
      }
    } catch (error) {
      console.error('Signaling server not available. Skipping integration tests.');
      console.error('Start services with: docker-compose -f docker-compose.test.yml up -d');
      throw error;
    }
  });

  afterEach(() => {
    // Clean up WebSocket connections
    if (client1) {
      client1.close();
      client1 = null;
    }
    if (client2) {
      client2.close();
      client2 = null;
    }
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await fetch(HEALTH_URL);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.status).toBe('ok');
    });
  });

  describe('Room Management', () => {
    it('should allow a client to join a room', async () => {
      const roomId = `test-room-${Date.now()}`;
      client1 = await createClient(roomId);

      sendMessage(client1, {
        type: 'join',
        participantId: 'user-1',
        name: 'Test User 1',
      });

      const response = await waitForMessage(client1, 'joined');
      expect(response.type).toBe('joined');
      expect(response.roomId).toBe(roomId);
    });

    it('should notify when another participant joins', async () => {
      const roomId = `test-room-${Date.now()}`;

      // First client joins
      client1 = await createClient(roomId);
      sendMessage(client1, {
        type: 'join',
        participantId: 'user-1',
        name: 'Test User 1',
      });
      await waitForMessage(client1, 'joined');

      // Second client joins
      client2 = await createClient(roomId);
      sendMessage(client2, {
        type: 'join',
        participantId: 'user-2',
        name: 'Test User 2',
      });

      // First client should receive notification
      const notification = await waitForMessage(client1, 'participant-joined');
      expect(notification.participantId).toBe('user-2');
    });

    it('should notify when a participant leaves', async () => {
      const roomId = `test-room-${Date.now()}`;

      // Both clients join
      client1 = await createClient(roomId);
      sendMessage(client1, { type: 'join', participantId: 'user-1' });
      await waitForMessage(client1, 'joined');

      client2 = await createClient(roomId);
      sendMessage(client2, { type: 'join', participantId: 'user-2' });
      await waitForMessage(client1, 'participant-joined');

      // Second client leaves
      client2.close();
      client2 = null;

      // First client should receive notification
      const notification = await waitForMessage(client1, 'participant-left');
      expect(notification.participantId).toBe('user-2');
    });
  });

  describe('WebRTC Signaling', () => {
    it('should relay SDP offers between participants', async () => {
      const roomId = `test-room-${Date.now()}`;

      // Both clients join
      client1 = await createClient(roomId);
      sendMessage(client1, { type: 'join', participantId: 'user-1' });
      await waitForMessage(client1, 'joined');

      client2 = await createClient(roomId);
      sendMessage(client2, { type: 'join', participantId: 'user-2' });
      await waitForMessage(client2, 'joined');
      await waitForMessage(client1, 'participant-joined');

      // Client 1 sends offer to Client 2
      const testOffer = {
        type: 'offer',
        to: 'user-2',
        sdp: 'v=0\r\no=- 123456 2 IN IP4 127.0.0.1\r\n...',
      };
      sendMessage(client1, testOffer);

      // Client 2 should receive the offer
      const receivedOffer = await waitForMessage(client2, 'offer');
      expect(receivedOffer.from).toBe('user-1');
      expect(receivedOffer.sdp).toBe(testOffer.sdp);
    });

    it('should relay ICE candidates between participants', async () => {
      const roomId = `test-room-${Date.now()}`;

      // Both clients join
      client1 = await createClient(roomId);
      sendMessage(client1, { type: 'join', participantId: 'user-1' });
      await waitForMessage(client1, 'joined');

      client2 = await createClient(roomId);
      sendMessage(client2, { type: 'join', participantId: 'user-2' });
      await waitForMessage(client2, 'joined');

      // Client 1 sends ICE candidate
      const iceCandidate = {
        type: 'ice-candidate',
        to: 'user-2',
        candidate: {
          candidate: 'candidate:1 1 UDP 2122252543 192.168.1.1 12345 typ host',
          sdpMid: 'audio',
          sdpMLineIndex: 0,
        },
      };
      sendMessage(client1, iceCandidate);

      // Client 2 should receive the candidate
      const received = await waitForMessage(client2, 'ice-candidate');
      expect(received.from).toBe('user-1');
      expect(received.candidate).toEqual(iceCandidate.candidate);
    });
  });

  describe('E2EE Key Distribution', () => {
    it('should relay E2EE keys between participants', async () => {
      const roomId = `test-room-${Date.now()}`;

      // Both clients join
      client1 = await createClient(roomId);
      sendMessage(client1, { type: 'join', participantId: 'user-1' });
      await waitForMessage(client1, 'joined');

      client2 = await createClient(roomId);
      sendMessage(client2, { type: 'join', participantId: 'user-2' });
      await waitForMessage(client2, 'joined');

      // Client 1 sends E2EE key
      const keyMessage = {
        type: 'e2ee-key',
        to: 'user-2',
        key: 'base64encodedkey==',
        generation: 0,
      };
      sendMessage(client1, keyMessage);

      // Client 2 should receive the key
      const received = await waitForMessage(client2, 'e2ee-key');
      expect(received.from).toBe('user-1');
      expect(received.key).toBe(keyMessage.key);
      expect(received.generation).toBe(0);
    });

    it('should broadcast E2EE keys to all participants', async () => {
      const roomId = `test-room-${Date.now()}`;

      // Three clients join
      client1 = await createClient(roomId);
      sendMessage(client1, { type: 'join', participantId: 'user-1' });
      await waitForMessage(client1, 'joined');

      client2 = await createClient(roomId);
      sendMessage(client2, { type: 'join', participantId: 'user-2' });
      await waitForMessage(client2, 'joined');

      const client3 = await createClient(roomId);
      sendMessage(client3, { type: 'join', participantId: 'user-3' });
      await waitForMessage(client3, 'joined');

      // Client 1 broadcasts key (no 'to' field)
      const keyMessage = {
        type: 'e2ee-key',
        key: 'broadcastkey==',
        generation: 1,
      };
      sendMessage(client1, keyMessage);

      // Both other clients should receive the key
      const [received2, received3] = await Promise.all([
        waitForMessage(client2, 'e2ee-key'),
        waitForMessage(client3, 'e2ee-key'),
      ]);

      expect(received2.from).toBe('user-1');
      expect(received3.from).toBe('user-1');

      client3.close();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      const roomId = `test-room-${Date.now()}`;
      client1 = await createClient(roomId);

      // Send invalid JSON
      client1.send('not valid json');

      // Should receive error message, not crash
      const error = await waitForMessage(client1, 'error');
      expect(error.type).toBe('error');
    });

    it('should handle messages to non-existent participants', async () => {
      const roomId = `test-room-${Date.now()}`;
      client1 = await createClient(roomId);
      sendMessage(client1, { type: 'join', participantId: 'user-1' });
      await waitForMessage(client1, 'joined');

      // Send to non-existent user
      sendMessage(client1, {
        type: 'offer',
        to: 'non-existent-user',
        sdp: 'test',
      });

      // Should receive error
      const error = await waitForMessage(client1, 'error');
      expect(error.code).toBe('PARTICIPANT_NOT_FOUND');
    });
  });
});
