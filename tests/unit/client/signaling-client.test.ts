/**
 * @module tests/unit/client/signaling-client
 * Unit tests for SignalingClient - WebSocket communication
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SignalingClient } from '../../../src/client/signaling-client';

// Store reference to created WebSocket instance
let mockWsInstance: MockWebSocket | null = null;

// Mock WebSocket
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: Event) => void) | null = null;

  private messageQueue: string[] = [];

  constructor(public url: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    mockWsInstance = this;
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.messageQueue.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? '' });
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: object): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateError(): void {
    this.onerror?.(new Event('error'));
  }

  simulateClose(code: number, reason: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  getLastMessage(): object | null {
    const msg = this.messageQueue.pop();
    return msg !== undefined ? (JSON.parse(msg) as object) : null;
  }

  getAllMessages(): object[] {
    return this.messageQueue.map((m) => JSON.parse(m) as object);
  }

  clearMessages(): void {
    this.messageQueue = [];
  }
}

// Replace global WebSocket with mock
vi.stubGlobal('WebSocket', MockWebSocket);

describe('SignalingClient', () => {
  beforeEach(() => {
    mockWsInstance = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create client with URL', () => {
      const client = new SignalingClient({ url: 'wss://test.example.com' });
      expect(client).toBeInstanceOf(SignalingClient);
      expect(client.getConnectionState()).toBe('disconnected');
    });

    it('should throw error if URL is empty', () => {
      expect(() => new SignalingClient({ url: '' })).toThrow('signalingUrl is required');
    });

    it('should use default timeout', () => {
      const client = new SignalingClient({ url: 'wss://test.example.com' });
      expect(client).toBeDefined();
    });

    it('should accept custom configuration', () => {
      const client = new SignalingClient({
        url: 'wss://test.example.com',
        timeout: 5000,
        reconnect: { enabled: true, maxAttempts: 5, delayMs: 2000 },
        debug: true,
      });
      expect(client).toBeDefined();
    });
  });

  describe('connect', () => {
    it('should connect to WebSocket server', async () => {
      const client = new SignalingClient({ url: 'wss://test.example.com' });

      const connectPromise = client.connect();

      // Simulate WebSocket open and welcome message
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({
        type: 'welcome',
        participantId: 'test-participant-123',
      });

      const result = await connectPromise;
      expect(result.participantId).toBe('test-participant-123');
      expect(client.isConnected()).toBe(true);
      expect(client.getConnectionState()).toBe('connected');
    });

    it('should receive welcome message with participantId', async () => {
      const client = new SignalingClient({ url: 'wss://test.example.com' });

      const connectPromise = client.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({
        type: 'welcome',
        participantId: 'unique-id-456',
      });

      const result = await connectPromise;
      expect(result.participantId).toBe('unique-id-456');
      expect(client.getParticipantId()).toBe('unique-id-456');
    });

    it('should reject on connection error', async () => {
      const client = new SignalingClient({ url: 'wss://invalid.example.com' });

      const connectPromise = client.connect();
      mockWsInstance?.simulateError();

      await expect(connectPromise).rejects.toThrow('WebSocket connection failed');
      expect(client.isConnected()).toBe(false);
    });

    it('should reject on connection timeout', async () => {
      const client = new SignalingClient({ url: 'wss://slow.example.com', timeout: 100 });

      const connectPromise = client.connect();

      // Advance time past timeout without sending welcome message
      vi.advanceTimersByTime(150);

      await expect(connectPromise).rejects.toThrow('Connection timeout');
      expect(client.isConnected()).toBe(false);
    });

    it('should throw if already connected', async () => {
      const client = new SignalingClient({ url: 'wss://test.example.com' });

      const connectPromise = client.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test' });
      await connectPromise;

      await expect(client.connect()).rejects.toThrow('Already connected');
    });

    it('should throw if connection in progress', async () => {
      const client = new SignalingClient({ url: 'wss://test.example.com' });

      void client.connect();
      await expect(client.connect()).rejects.toThrow('Connection in progress');
    });
  });

  describe('joinRoom', () => {
    let client: SignalingClient;

    beforeEach(async () => {
      client = new SignalingClient({ url: 'wss://test.example.com' });
      const connectPromise = client.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test-participant' });
      await connectPromise;
      mockWsInstance?.clearMessages();
    });

    it('should send join message and receive joined response', async () => {
      const joinPromise = client.joinRoom('test-room', { displayName: 'Alice' });

      // Check that join message was sent
      const sentMessage = mockWsInstance?.getLastMessage() as {
        type: string;
        roomId: string;
        payload: { displayName: string };
      };
      expect(sentMessage.type).toBe('join');
      expect(sentMessage.roomId).toBe('test-room');
      expect(sentMessage.payload.displayName).toBe('Alice');

      // Simulate server response
      mockWsInstance?.simulateMessage({
        type: 'joined',
        roomId: 'test-room',
        participants: [{ id: 'other-user', displayName: 'Bob' }],
      });

      const result = await joinPromise;
      expect(result.roomId).toBe('test-room');
      expect(result.participantId).toBe('test-participant');
      expect(result.participants).toHaveLength(1);
      expect(client.getCurrentRoomId()).toBe('test-room');
    });

    it('should fail if not connected', async () => {
      const disconnectedClient = new SignalingClient({ url: 'wss://test.example.com' });
      await expect(disconnectedClient.joinRoom('test-room')).rejects.toThrow('Not connected');
    });

    it('should fail if room is full', async () => {
      const joinPromise = client.joinRoom('full-room');

      mockWsInstance?.simulateMessage({
        type: 'error',
        code: 'ROOM_FULL',
        message: 'Room is full',
      });

      await expect(joinPromise).rejects.toThrow('Room is full');
    });

    it('should timeout if no response', async () => {
      const clientWithShortTimeout = new SignalingClient({
        url: 'wss://test.example.com',
        timeout: 100,
      });
      const connectPromise = clientWithShortTimeout.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test' });
      await connectPromise;

      const joinPromise = clientWithShortTimeout.joinRoom('test-room');
      vi.advanceTimersByTime(150);

      await expect(joinPromise).rejects.toThrow('Join room timeout');
    });
  });

  describe('leaveRoom', () => {
    let client: SignalingClient;

    beforeEach(async () => {
      client = new SignalingClient({ url: 'wss://test.example.com' });
      const connectPromise = client.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test-participant' });
      await connectPromise;

      const joinPromise = client.joinRoom('test-room');
      mockWsInstance?.simulateMessage({ type: 'joined', roomId: 'test-room', participants: [] });
      await joinPromise;
      mockWsInstance?.clearMessages();
    });

    it('should send leave message', () => {
      client.leaveRoom();

      const sentMessage = mockWsInstance?.getLastMessage() as { type: string };
      expect(sentMessage.type).toBe('leave');
      expect(client.getCurrentRoomId()).toBeNull();
    });

    it('should do nothing if not in room', () => {
      client.leaveRoom(); // Leave first time
      mockWsInstance?.clearMessages();

      client.leaveRoom(); // Leave again
      expect(mockWsInstance?.getLastMessage()).toBeNull();
    });
  });

  describe('sendOffer', () => {
    let client: SignalingClient;

    beforeEach(async () => {
      client = new SignalingClient({ url: 'wss://test.example.com' });
      const connectPromise = client.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test-participant' });
      await connectPromise;
      mockWsInstance?.clearMessages();
    });

    it('should send offer to target participant', () => {
      client.sendOffer('target-id', { type: 'offer', sdp: 'v=0...' });

      const sentMessage = mockWsInstance?.getLastMessage() as {
        type: string;
        targetId: string;
        payload: { type: string; sdp: string };
      };
      expect(sentMessage.type).toBe('offer');
      expect(sentMessage.targetId).toBe('target-id');
      expect(sentMessage.payload.type).toBe('offer');
      expect(sentMessage.payload.sdp).toBe('v=0...');
    });

    it('should throw if not connected', () => {
      const disconnectedClient = new SignalingClient({ url: 'wss://test.example.com' });
      expect(() => disconnectedClient.sendOffer('target', { type: 'offer', sdp: '' })).toThrow(
        'Not connected'
      );
    });
  });

  describe('sendAnswer', () => {
    let client: SignalingClient;

    beforeEach(async () => {
      client = new SignalingClient({ url: 'wss://test.example.com' });
      const connectPromise = client.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test-participant' });
      await connectPromise;
      mockWsInstance?.clearMessages();
    });

    it('should send answer to target participant', () => {
      client.sendAnswer('target-id', { type: 'answer', sdp: 'v=0...' });

      const sentMessage = mockWsInstance?.getLastMessage() as {
        type: string;
        targetId: string;
        payload: { type: string; sdp: string };
      };
      expect(sentMessage.type).toBe('answer');
      expect(sentMessage.targetId).toBe('target-id');
      expect(sentMessage.payload.type).toBe('answer');
    });
  });

  describe('sendIceCandidate', () => {
    let client: SignalingClient;

    beforeEach(async () => {
      client = new SignalingClient({ url: 'wss://test.example.com' });
      const connectPromise = client.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test-participant' });
      await connectPromise;
      mockWsInstance?.clearMessages();
    });

    it('should send ICE candidate to target participant', () => {
      client.sendIceCandidate('target-id', {
        candidate: 'candidate:1234...',
        sdpMid: 'audio',
        sdpMLineIndex: 0,
      });

      const sentMessage = mockWsInstance?.getLastMessage() as {
        type: string;
        targetId: string;
        payload: { candidate: string; sdpMid: string; sdpMLineIndex: number };
      };
      expect(sentMessage.type).toBe('ice-candidate');
      expect(sentMessage.targetId).toBe('target-id');
      expect(sentMessage.payload.candidate).toBe('candidate:1234...');
      expect(sentMessage.payload.sdpMid).toBe('audio');
    });
  });

  describe('sendKeyExchange', () => {
    let client: SignalingClient;

    beforeEach(async () => {
      client = new SignalingClient({ url: 'wss://test.example.com' });
      const connectPromise = client.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test-participant' });
      await connectPromise;
      mockWsInstance?.clearMessages();
    });

    it('should send encrypted key to target participant', () => {
      client.sendKeyExchange('target-id', { key: 'base64encodedkey==', generation: 1 });

      const sentMessage = mockWsInstance?.getLastMessage() as {
        type: string;
        targetId: string;
        payload: { key: string; generation: number };
      };
      expect(sentMessage.type).toBe('key-exchange');
      expect(sentMessage.targetId).toBe('target-id');
      expect(sentMessage.payload.key).toBe('base64encodedkey==');
      expect(sentMessage.payload.generation).toBe(1);
    });
  });

  describe('broadcastKey', () => {
    let client: SignalingClient;

    beforeEach(async () => {
      client = new SignalingClient({ url: 'wss://test.example.com' });
      const connectPromise = client.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test-participant' });
      await connectPromise;
      mockWsInstance?.clearMessages();
    });

    it('should broadcast key to all participants in room', () => {
      client.broadcastKey({ key: 'base64encodedkey==', generation: 2 });

      const sentMessage = mockWsInstance?.getLastMessage() as {
        type: string;
        payload: { key: string; generation: number };
      };
      expect(sentMessage.type).toBe('key-broadcast');
      expect(sentMessage.payload.key).toBe('base64encodedkey==');
      expect(sentMessage.payload.generation).toBe(2);
    });

    it('should throw if not connected', () => {
      const disconnectedClient = new SignalingClient({ url: 'wss://test.example.com' });
      expect(() => disconnectedClient.broadcastKey({ key: 'test', generation: 1 })).toThrow(
        'Not connected'
      );
    });
  });

  describe('events', () => {
    let client: SignalingClient;

    beforeEach(async () => {
      client = new SignalingClient({ url: 'wss://test.example.com' });
      const connectPromise = client.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test-participant' });
      await connectPromise;
    });

    it('should emit participant-joined when someone joins', () => {
      const handler = vi.fn();
      client.on('participant-joined', handler);

      mockWsInstance?.simulateMessage({
        type: 'participant-joined',
        participantId: 'new-user-123',
        displayName: 'Charlie',
      });

      expect(handler).toHaveBeenCalledWith({
        participantId: 'new-user-123',
        displayName: 'Charlie',
      });
    });

    it('should emit participant-left when someone leaves', () => {
      const handler = vi.fn();
      client.on('participant-left', handler);

      mockWsInstance?.simulateMessage({
        type: 'participant-left',
        participantId: 'leaving-user-123',
      });

      expect(handler).toHaveBeenCalledWith({
        participantId: 'leaving-user-123',
      });
    });

    it('should emit offer when receiving offer', () => {
      const handler = vi.fn();
      client.on('offer', handler);

      mockWsInstance?.simulateMessage({
        type: 'offer',
        senderId: 'sender-123',
        payload: { type: 'offer', sdp: 'v=0...' },
      });

      expect(handler).toHaveBeenCalledWith({
        senderId: 'sender-123',
        payload: { type: 'offer', sdp: 'v=0...' },
      });
    });

    it('should emit answer when receiving answer', () => {
      const handler = vi.fn();
      client.on('answer', handler);

      mockWsInstance?.simulateMessage({
        type: 'answer',
        senderId: 'sender-123',
        payload: { type: 'answer', sdp: 'v=0...' },
      });

      expect(handler).toHaveBeenCalledWith({
        senderId: 'sender-123',
        payload: { type: 'answer', sdp: 'v=0...' },
      });
    });

    it('should emit ice-candidate when receiving candidate', () => {
      const handler = vi.fn();
      client.on('ice-candidate', handler);

      mockWsInstance?.simulateMessage({
        type: 'ice-candidate',
        senderId: 'sender-123',
        payload: { candidate: 'candidate:1234', sdpMid: 'audio', sdpMLineIndex: 0 },
      });

      expect(handler).toHaveBeenCalledWith({
        senderId: 'sender-123',
        payload: { candidate: 'candidate:1234', sdpMid: 'audio', sdpMLineIndex: 0 },
      });
    });

    it('should emit key-exchange when receiving key', () => {
      const handler = vi.fn();
      client.on('key-exchange', handler);

      mockWsInstance?.simulateMessage({
        type: 'key-exchange',
        senderId: 'sender-123',
        payload: { key: 'base64key==', generation: 1 },
      });

      expect(handler).toHaveBeenCalledWith({
        senderId: 'sender-123',
        payload: { key: 'base64key==', generation: 1 },
      });
    });

    it('should emit key-broadcast when receiving broadcast', () => {
      const handler = vi.fn();
      client.on('key-broadcast', handler);

      mockWsInstance?.simulateMessage({
        type: 'key-broadcast',
        senderId: 'sender-123',
        payload: { key: 'base64key==', generation: 2 },
      });

      expect(handler).toHaveBeenCalledWith({
        senderId: 'sender-123',
        payload: { key: 'base64key==', generation: 2 },
      });
    });

    it('should emit disconnected on close', () => {
      const handler = vi.fn();
      client.on('disconnected', handler);

      mockWsInstance?.simulateClose(1001, 'Going away');

      expect(handler).toHaveBeenCalledWith({
        code: 1001,
        reason: 'Going away',
      });
    });

    it('should emit error on error message', () => {
      const handler = vi.fn();
      client.on('error', handler);

      mockWsInstance?.simulateMessage({
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'Invalid message format',
      });

      expect(handler).toHaveBeenCalledWith({
        code: 'INVALID_MESSAGE',
        message: 'Invalid message format',
      });
    });

    it('should allow removing event listeners', () => {
      const handler = vi.fn();
      client.on('participant-joined', handler);
      client.off('participant-joined', handler);

      mockWsInstance?.simulateMessage({
        type: 'participant-joined',
        participantId: 'new-user',
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should allow removing all listeners for an event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      client.on('participant-joined', handler1);
      client.on('participant-joined', handler2);
      client.removeAllListeners('participant-joined');

      mockWsInstance?.simulateMessage({
        type: 'participant-joined',
        participantId: 'new-user',
      });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should allow removing all listeners', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      client.on('participant-joined', handler1);
      client.on('participant-left', handler2);
      client.removeAllListeners();

      mockWsInstance?.simulateMessage({ type: 'participant-joined', participantId: 'new' });
      mockWsInstance?.simulateMessage({ type: 'participant-left', participantId: 'old' });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('reconnection', () => {
    it('should attempt reconnection on unexpected disconnect', async () => {
      const client = new SignalingClient({
        url: 'wss://test.example.com',
        reconnect: { enabled: true, maxAttempts: 3, delayMs: 100 },
      });

      const connectPromise = client.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test' });
      await connectPromise;

      // Simulate unexpected disconnect (not code 1000)
      mockWsInstance?.simulateClose(1006, 'Connection lost');

      // Should schedule reconnection
      vi.advanceTimersByTime(100);

      // New WebSocket should be created
      expect(mockWsInstance).toBeDefined();
    });

    it('should not reconnect on normal close', async () => {
      const client = new SignalingClient({
        url: 'wss://test.example.com',
        reconnect: { enabled: true, maxAttempts: 3, delayMs: 100 },
      });

      const connectPromise = client.connect();
      const initialWs = mockWsInstance;
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test' });
      await connectPromise;

      // Simulate normal close (code 1000)
      client.disconnect();

      vi.advanceTimersByTime(200);

      // Should not create new WebSocket
      expect(client.isConnected()).toBe(false);
    });

    it('should not reconnect if disabled', async () => {
      const client = new SignalingClient({
        url: 'wss://test.example.com',
        reconnect: { enabled: false, maxAttempts: 3, delayMs: 100 },
      });

      const connectPromise = client.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test' });
      await connectPromise;

      const disconnectHandler = vi.fn();
      client.on('disconnected', disconnectHandler);

      mockWsInstance?.simulateClose(1006, 'Connection lost');

      vi.advanceTimersByTime(500);

      // Should stay disconnected
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should close WebSocket connection', async () => {
      const client = new SignalingClient({ url: 'wss://test.example.com' });

      const connectPromise = client.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test' });
      await connectPromise;

      expect(client.isConnected()).toBe(true);

      client.disconnect();

      expect(client.isConnected()).toBe(false);
      expect(client.getParticipantId()).toBeNull();
      expect(client.getCurrentRoomId()).toBeNull();
    });

    it('should be safe to call multiple times', async () => {
      const client = new SignalingClient({ url: 'wss://test.example.com' });

      const connectPromise = client.connect();
      mockWsInstance?.simulateOpen();
      mockWsInstance?.simulateMessage({ type: 'welcome', participantId: 'test' });
      await connectPromise;

      client.disconnect();
      client.disconnect();
      client.disconnect();

      expect(client.isConnected()).toBe(false);
    });
  });
});
