/**
 * @module client/signaling-client
 * WebSocket-based signaling client for WebRTC coordination
 *
 * @description
 * Handles all signaling communication including:
 * - Room management (join/leave)
 * - WebRTC offer/answer exchange
 * - ICE candidate relay
 * - E2EE key distribution
 */

import type { KeyGeneration } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Signaling client configuration
 */
export interface SignalingClientConfig {
  /** WebSocket URL for signaling server */
  url: string;
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** Reconnection settings */
  reconnect?: {
    enabled: boolean;
    maxAttempts: number;
    delayMs: number;
  };
  /** Debug logging */
  debug?: boolean;
}

/**
 * Participant info from signaling
 */
export interface SignalingParticipant {
  id: string;
  displayName?: string;
}

/**
 * Join room options
 */
export interface JoinRoomOptions {
  displayName?: string;
  roomName?: string;
}

/**
 * Join room result
 */
export interface JoinRoomResult {
  roomId: string;
  participantId: string;
  participants: SignalingParticipant[];
}

/**
 * SDP description for WebRTC
 */
export interface SDPDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

/**
 * ICE candidate
 */
export interface ICECandidateInfo {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

/**
 * Key exchange payload
 */
export interface KeyExchangePayload {
  key: string; // Base64 encoded
  generation: KeyGeneration;
}

/**
 * Signaling message from server
 */
interface ServerMessage {
  type: string;
  participantId?: string;
  senderId?: string;
  roomId?: string;
  displayName?: string;
  participants?: SignalingParticipant[];
  payload?: unknown;
  code?: string;
  message?: string;
}

/**
 * Event types emitted by SignalingClient
 */
export type SignalingEventType =
  | 'connected'
  | 'disconnected'
  | 'participant-joined'
  | 'participant-left'
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'key-exchange'
  | 'key-broadcast'
  | 'error';

/**
 * Event data for each event type
 */
export interface SignalingEventMap {
  connected: { participantId: string };
  disconnected: { code: number; reason: string };
  'participant-joined': { participantId: string; displayName?: string };
  'participant-left': { participantId: string };
  offer: { senderId: string; payload: SDPDescription };
  answer: { senderId: string; payload: SDPDescription };
  'ice-candidate': { senderId: string; payload: ICECandidateInfo };
  'key-exchange': { senderId: string; payload: KeyExchangePayload };
  'key-broadcast': { senderId: string; payload: KeyExchangePayload };
  error: { code: string; message: string };
}

/**
 * Event listener type
 */
type SignalingEventListener<T extends SignalingEventType> = (data: SignalingEventMap[T]) => void;

/**
 * Connection state
 */
export type SignalingConnectionState = 'disconnected' | 'connecting' | 'connected';

// ============================================================================
// SignalingClient Class
// ============================================================================

/**
 * WebSocket client for WebRTC signaling
 */
export class SignalingClient {
  private readonly config: Required<SignalingClientConfig>;
  private ws: WebSocket | null = null;
  private participantId: string | null = null;
  private currentRoomId: string | null = null;
  private connectionState: SignalingConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Event listeners
  private readonly listeners = new Map<
    SignalingEventType,
    Set<SignalingEventListener<SignalingEventType>>
  >();

  // Pending promises for request/response pattern
  private pendingJoin: {
    resolve: (result: JoinRoomResult) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(config: SignalingClientConfig) {
    if (config.url === undefined || config.url === '') {
      throw new Error('signalingUrl is required');
    }

    this.config = {
      url: config.url,
      timeout: config.timeout ?? 10000,
      reconnect: config.reconnect ?? { enabled: true, maxAttempts: 5, delayMs: 1000 },
      debug: config.debug ?? false,
    };
  }

  /**
   * Connect to signaling server
   */
  async connect(): Promise<{ participantId: string }> {
    if (this.connectionState === 'connected') {
      throw new Error('Already connected');
    }

    if (this.connectionState === 'connecting') {
      throw new Error('Connection in progress');
    }

    this.connectionState = 'connecting';

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.ws !== null) {
          this.ws.close();
        }
        this.connectionState = 'disconnected';
        reject(new Error('Connection timeout'));
      }, this.config.timeout);

      try {
        this.ws = new WebSocket(this.config.url);

        this.ws.onopen = (): void => {
          this.log('WebSocket connected');
          // Wait for welcome message
        };

        this.ws.onmessage = (event: MessageEvent): void => {
          this.handleMessage(event.data as string, (welcomeData) => {
            clearTimeout(timeoutId);
            this.connectionState = 'connected';
            this.reconnectAttempts = 0;
            resolve(welcomeData);
          });
        };

        this.ws.onerror = (): void => {
          clearTimeout(timeoutId);
          this.connectionState = 'disconnected';
          reject(new Error('WebSocket connection failed'));
        };

        this.ws.onclose = (event: CloseEvent): void => {
          this.handleClose(event);
        };
      } catch (error) {
        clearTimeout(timeoutId);
        this.connectionState = 'disconnected';
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Disconnect from signaling server
   */
  disconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws !== null) {
      this.ws.onclose = null; // Prevent reconnection
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.connectionState = 'disconnected';
    this.participantId = null;
    this.currentRoomId = null;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === 'connected' && this.ws !== null;
  }

  /**
   * Get current connection state
   */
  getConnectionState(): SignalingConnectionState {
    return this.connectionState;
  }

  /**
   * Get participant ID
   */
  getParticipantId(): string | null {
    return this.participantId;
  }

  /**
   * Get current room ID
   */
  getCurrentRoomId(): string | null {
    return this.currentRoomId;
  }

  /**
   * Join a room
   */
  async joinRoom(roomId: string, options?: JoinRoomOptions): Promise<JoinRoomResult> {
    if (!this.isConnected()) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      this.pendingJoin = { resolve, reject };

      const timeoutId = setTimeout(() => {
        this.pendingJoin = null;
        reject(new Error('Join room timeout'));
      }, this.config.timeout);

      // Store timeout in pending join so we can clear it
      const originalResolve = this.pendingJoin.resolve;
      this.pendingJoin.resolve = (result: JoinRoomResult): void => {
        clearTimeout(timeoutId);
        originalResolve(result);
      };

      const originalReject = this.pendingJoin.reject;
      this.pendingJoin.reject = (error: Error): void => {
        clearTimeout(timeoutId);
        originalReject(error);
      };

      this.send({
        type: 'join',
        roomId,
        payload: {
          displayName: options?.displayName,
          roomName: options?.roomName,
        },
      });
    });
  }

  /**
   * Leave current room
   */
  leaveRoom(): void {
    if (!this.isConnected() || this.currentRoomId === null) {
      return;
    }

    this.send({ type: 'leave' });
    this.currentRoomId = null;
  }

  /**
   * Send WebRTC offer
   */
  sendOffer(targetId: string, offer: SDPDescription): void {
    this.sendToTarget('offer', targetId, offer);
  }

  /**
   * Send WebRTC answer
   */
  sendAnswer(targetId: string, answer: SDPDescription): void {
    this.sendToTarget('answer', targetId, answer);
  }

  /**
   * Send ICE candidate
   */
  sendIceCandidate(targetId: string, candidate: ICECandidateInfo): void {
    this.sendToTarget('ice-candidate', targetId, candidate);
  }

  /**
   * Send key exchange to specific participant
   */
  sendKeyExchange(targetId: string, payload: KeyExchangePayload): void {
    this.sendToTarget('key-exchange', targetId, payload);
  }

  /**
   * Broadcast key to all participants in room
   */
  broadcastKey(payload: KeyExchangePayload): void {
    if (!this.isConnected()) {
      throw new Error('Not connected');
    }

    this.send({
      type: 'key-broadcast',
      payload,
    });
  }

  /**
   * Register event listener
   */
  on<T extends SignalingEventType>(event: T, listener: SignalingEventListener<T>): void {
    let eventListeners = this.listeners.get(event);
    if (eventListeners === undefined) {
      eventListeners = new Set();
      this.listeners.set(event, eventListeners);
    }
    eventListeners.add(listener as SignalingEventListener<SignalingEventType>);
  }

  /**
   * Remove event listener
   */
  off<T extends SignalingEventType>(event: T, listener: SignalingEventListener<T>): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners !== undefined) {
      eventListeners.delete(listener as SignalingEventListener<SignalingEventType>);
    }
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners(event?: SignalingEventType): void {
    if (event !== undefined) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private send(message: object): void {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.ws.send(JSON.stringify(message));
  }

  private sendToTarget(type: string, targetId: string, payload: unknown): void {
    if (!this.isConnected()) {
      throw new Error('Not connected');
    }

    this.send({
      type,
      targetId,
      payload,
    });
  }

  private handleMessage(data: string, onWelcome?: (data: { participantId: string }) => void): void {
    let message: ServerMessage;

    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      this.log('Failed to parse message:', data);
      return;
    }

    this.log('Received:', message.type);

    switch (message.type) {
      case 'welcome':
        this.participantId = message.participantId ?? null;
        if (onWelcome !== undefined && this.participantId !== null) {
          onWelcome({ participantId: this.participantId });
        }
        this.emit('connected', { participantId: this.participantId ?? '' });
        break;

      case 'joined':
        this.currentRoomId = message.roomId ?? null;
        if (this.pendingJoin !== null) {
          this.pendingJoin.resolve({
            roomId: message.roomId ?? '',
            participantId: this.participantId ?? '',
            participants: message.participants ?? [],
          });
          this.pendingJoin = null;
        }
        break;

      case 'error':
        if (this.pendingJoin !== null) {
          this.pendingJoin.reject(new Error(message.message ?? 'Unknown error'));
          this.pendingJoin = null;
        }
        this.emit('error', {
          code: message.code ?? 'UNKNOWN',
          message: message.message ?? 'Unknown error',
        });
        break;

      case 'participant-joined':
        this.emit('participant-joined', {
          participantId: message.participantId ?? '',
          ...(message.displayName !== undefined && { displayName: message.displayName }),
        });
        break;

      case 'participant-left':
        this.emit('participant-left', {
          participantId: message.participantId ?? '',
        });
        break;

      case 'offer':
        this.emit('offer', {
          senderId: message.senderId ?? '',
          payload: message.payload as SDPDescription,
        });
        break;

      case 'answer':
        this.emit('answer', {
          senderId: message.senderId ?? '',
          payload: message.payload as SDPDescription,
        });
        break;

      case 'ice-candidate':
        this.emit('ice-candidate', {
          senderId: message.senderId ?? '',
          payload: message.payload as ICECandidateInfo,
        });
        break;

      case 'key-exchange':
        this.emit('key-exchange', {
          senderId: message.senderId ?? '',
          payload: message.payload as KeyExchangePayload,
        });
        break;

      case 'key-broadcast':
        this.emit('key-broadcast', {
          senderId: message.senderId ?? '',
          payload: message.payload as KeyExchangePayload,
        });
        break;

      case 'pong':
        // Heartbeat response, ignore
        break;

      default:
        this.log('Unknown message type:', message.type);
    }
  }

  private handleClose(event: CloseEvent): void {
    this.log('WebSocket closed:', event.code, event.reason);
    this.connectionState = 'disconnected';

    this.emit('disconnected', {
      code: event.code,
      reason: event.reason,
    });

    // Attempt reconnection if enabled
    if (
      this.config.reconnect.enabled &&
      event.code !== 1000 &&
      this.reconnectAttempts < this.config.reconnect.maxAttempts
    ) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.config.reconnect.delayMs * this.reconnectAttempts;

    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      void this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    try {
      await this.connect();

      // Rejoin room if we were in one
      if (this.currentRoomId !== null) {
        const roomId = this.currentRoomId;
        this.currentRoomId = null;
        await this.joinRoom(roomId);
      }
    } catch (error) {
      this.log('Reconnection failed:', error);
      if (this.reconnectAttempts < this.config.reconnect.maxAttempts) {
        this.scheduleReconnect();
      }
    }
  }

  private emit<T extends SignalingEventType>(event: T, data: SignalingEventMap[T]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners !== undefined) {
      for (const listener of eventListeners) {
        try {
          (listener as SignalingEventListener<T>)(data);
        } catch (error) {
          this.log('Event listener error:', error);
        }
      }
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      // eslint-disable-next-line no-console
      console.log('[SignalingClient]', ...args);
    }
  }
}
