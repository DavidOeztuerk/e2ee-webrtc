/**
 * @module client/e2ee-client
 * Main E2EE WebRTC client class
 *
 * @description
 * The primary interface for E2EE WebRTC functionality.
 * Integrates signaling, peer connections, key management, and encryption.
 *
 * @example
 * ```typescript
 * const client = new E2EEClient({
 *   signalingUrl: 'wss://signal.example.com',
 * });
 *
 * await client.connect();
 * await client.joinRoom('my-room', { displayName: 'Alice' });
 *
 * const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
 * client.setLocalStream(stream);
 *
 * client.on('remote-stream', ({ participantId, stream }) => {
 *   videoElement.srcObject = stream;
 * });
 * ```
 */

import { SignalingClient, type JoinRoomOptions } from './signaling-client';
import { PeerManager, type IceServerConfig, type EncryptionTransform } from './peer-manager';
import { KeyManager } from '../core/key-manager';
import { FrameProcessor, type KeyProvider } from '../core/frame-processor';
import { detectCapabilities, isE2EESupported } from '../browser/detection';
import type { KeyGeneration, BrowserCapabilities } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * E2EE client configuration
 */
export interface E2EEClientConfig {
  /** Signaling server WebSocket URL */
  signalingUrl: string;
  /** ICE servers for STUN/TURN */
  iceServers?: IceServerConfig[];
  /** Key rotation interval in milliseconds (0 to disable) */
  keyRotationIntervalMs?: number;
  /** Number of previous keys to keep for decryption */
  keyHistorySize?: number;
  /** Signaling reconnection settings */
  reconnect?: {
    enabled: boolean;
    maxAttempts: number;
    delayMs: number;
  };
  /** Debug logging */
  debug?: boolean;
}

/**
 * Client state
 */
export type E2EEClientState = 'disconnected' | 'connecting' | 'connected' | 'in-room';

/**
 * Participant info
 */
export interface E2EEParticipant {
  id: string;
  displayName: string | undefined;
  encryptionVerified: boolean;
  connectionState: RTCPeerConnectionState;
}

/**
 * Event types for E2EEClient
 */
export type E2EEClientEventType =
  | 'connected'
  | 'disconnected'
  | 'room-joined'
  | 'room-left'
  | 'participant-joined'
  | 'participant-left'
  | 'remote-stream'
  | 'encryption-enabled'
  | 'key-rotated'
  | 'encryption-verified'
  | 'error';

/**
 * Event data map
 */
export interface E2EEClientEventMap {
  connected: { participantId: string };
  disconnected: { reason: string };
  'room-joined': { roomId: string; participants: E2EEParticipant[] };
  'room-left': { roomId: string };
  'participant-joined': { participant: E2EEParticipant };
  'participant-left': { participantId: string };
  'remote-stream': { participantId: string; stream: MediaStream };
  'encryption-enabled': { generation: KeyGeneration };
  'key-rotated': { generation: KeyGeneration };
  'encryption-verified': { participantId: string; fingerprint: string };
  error: { code: string; message: string; recoverable: boolean };
}

/**
 * Event listener type
 */
type E2EEClientEventListener<T extends E2EEClientEventType> = (data: E2EEClientEventMap[T]) => void;

/**
 * Client statistics
 */
export interface E2EEClientStats {
  participantCount: number;
  framesEncrypted: number;
  framesDecrypted: number;
  encryptionErrors: number;
  decryptionErrors: number;
  currentKeyGeneration: KeyGeneration;
  browserCapabilities: BrowserCapabilities;
}

// ============================================================================
// E2EEClient Class
// ============================================================================

/**
 * Main E2EE WebRTC client
 */
export class E2EEClient {
  private readonly config: Required<E2EEClientConfig>;
  private readonly signaling: SignalingClient;
  private readonly peerManager: PeerManager;
  private readonly keyManager: KeyManager;
  private readonly frameProcessors = new Map<string, FrameProcessor>();
  private readonly capabilities: BrowserCapabilities;
  private readonly listeners = new Map<
    E2EEClientEventType,
    Set<E2EEClientEventListener<E2EEClientEventType>>
  >();

  private state: E2EEClientState = 'disconnected';
  private currentRoomId: string | null = null;
  private localStream: MediaStream | null = null;
  private participants = new Map<string, E2EEParticipant>();
  private remoteStreams = new Map<string, MediaStream>();

  constructor(config: E2EEClientConfig) {
    if (config.signalingUrl === undefined || config.signalingUrl === '') {
      throw new Error('signalingUrl is required');
    }

    this.config = {
      signalingUrl: config.signalingUrl,
      iceServers: config.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }],
      keyRotationIntervalMs: config.keyRotationIntervalMs ?? 0,
      keyHistorySize: config.keyHistorySize ?? 5,
      reconnect: config.reconnect ?? { enabled: true, maxAttempts: 5, delayMs: 1000 },
      debug: config.debug ?? false,
    };

    // Check browser support
    this.capabilities = detectCapabilities();
    if (!isE2EESupported()) {
      this.log('Warning: E2EE not fully supported in this browser');
    }

    // Initialize components
    this.signaling = new SignalingClient({
      url: this.config.signalingUrl,
      reconnect: this.config.reconnect,
      debug: this.config.debug,
    });

    this.peerManager = new PeerManager({
      iceServers: this.config.iceServers,
      debug: this.config.debug,
    });

    this.keyManager = new KeyManager({
      keyHistorySize: this.config.keyHistorySize,
      autoRotate: this.config.keyRotationIntervalMs > 0,
      rotationIntervalMs: this.config.keyRotationIntervalMs,
    });

    this.setupEventHandlers();
  }

  /**
   * Get current client state
   */
  getState(): E2EEClientState {
    return this.state;
  }

  /**
   * Get current room ID
   */
  getCurrentRoom(): string | null {
    return this.currentRoomId;
  }

  /**
   * Get local stream
   */
  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  /**
   * Get current key generation
   */
  getKeyGeneration(): KeyGeneration {
    return this.keyManager.getState().currentGeneration;
  }

  /**
   * Get browser capabilities
   */
  getCapabilities(): BrowserCapabilities {
    return { ...this.capabilities };
  }

  /**
   * Get participant list
   */
  getParticipants(): E2EEParticipant[] {
    return Array.from(this.participants.values());
  }

  /**
   * Connect to signaling server
   */
  async connect(): Promise<void> {
    if (this.state !== 'disconnected') {
      throw new Error('Already connected or connecting');
    }

    this.state = 'connecting';

    try {
      const { participantId } = await this.signaling.connect();
      this.state = 'connected';
      this.emit('connected', { participantId });
      this.log(`Connected as ${participantId}`);
    } catch (error) {
      this.state = 'disconnected';
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', {
        code: 'CONNECTION_FAILED',
        message,
        recoverable: true,
      });
      throw error;
    }
  }

  /**
   * Disconnect from signaling server
   */
  disconnect(): void {
    if (this.currentRoomId !== null) {
      this.leaveRoom();
    }

    this.signaling.disconnect();
    this.keyManager.destroy();
    this.peerManager.closeAll();
    this.frameProcessors.clear();

    this.state = 'disconnected';
    this.emit('disconnected', { reason: 'Client disconnect' });
  }

  /**
   * Join a room
   */
  async joinRoom(roomId: string, options?: JoinRoomOptions): Promise<void> {
    if (this.state !== 'connected') {
      throw new Error('Not connected');
    }

    try {
      const result = await this.signaling.joinRoom(roomId, options);
      this.currentRoomId = roomId;
      this.state = 'in-room';

      // Initialize encryption
      await this.keyManager.generateKey();
      this.emit('encryption-enabled', { generation: this.keyManager.getState().currentGeneration });

      // Setup transform factories for encryption
      this.setupEncryptionTransforms();

      // Create participants from existing room members
      const participants: E2EEParticipant[] = [];
      for (const p of result.participants) {
        if (p.id !== this.signaling.getParticipantId()) {
          const participant: E2EEParticipant = {
            id: p.id,
            displayName: p.displayName,
            encryptionVerified: false,
            connectionState: 'new',
          };
          this.participants.set(p.id, participant);
          participants.push(participant);

          // Create peer connection for existing participant
          await this.createPeerConnectionForParticipant(p.id, true);
        }
      }

      this.emit('room-joined', { roomId, participants });
      this.log(`Joined room ${roomId} with ${participants.length} participants`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', {
        code: 'JOIN_FAILED',
        message,
        recoverable: true,
      });
      throw error;
    }
  }

  /**
   * Leave current room
   */
  leaveRoom(): void {
    if (this.currentRoomId === null) {
      return;
    }

    const roomId = this.currentRoomId;

    // Close all peer connections
    this.peerManager.closeAll();
    this.participants.clear();
    this.remoteStreams.clear();
    this.frameProcessors.clear();

    // Leave signaling room
    this.signaling.leaveRoom();

    this.currentRoomId = null;
    this.state = 'connected';

    this.emit('room-left', { roomId });
    this.log(`Left room ${roomId}`);
  }

  /**
   * Set local media stream
   */
  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;

    // Add tracks to all existing peer connections
    for (const track of stream.getTracks()) {
      this.peerManager.addTrack(track, stream);
    }

    this.log(`Set local stream with ${stream.getTracks().length} tracks`);
  }

  /**
   * Remove local stream
   */
  removeLocalStream(): void {
    if (this.localStream === null) {
      return;
    }

    for (const track of this.localStream.getTracks()) {
      this.peerManager.removeTrack(track.id);
    }

    this.localStream = null;
  }

  /**
   * Manually rotate encryption key
   */
  async rotateKey(): Promise<void> {
    await this.keyManager.rotateKey();
  }

  /**
   * Get formatted key fingerprint
   */
  async getFingerprint(): Promise<string> {
    return this.keyManager.getFormattedFingerprint();
  }

  /**
   * Get statistics
   */
  getStats(): E2EEClientStats {
    let framesEncrypted = 0;
    let framesDecrypted = 0;
    let encryptionErrors = 0;
    let decryptionErrors = 0;

    for (const processor of this.frameProcessors.values()) {
      const stats = processor.getStats();
      framesEncrypted += stats.framesEncrypted;
      framesDecrypted += stats.framesDecrypted;
      encryptionErrors += stats.encryptionErrors;
      decryptionErrors += stats.decryptionErrors;
    }

    return {
      participantCount: this.participants.size,
      framesEncrypted,
      framesDecrypted,
      encryptionErrors,
      decryptionErrors,
      currentKeyGeneration: this.keyManager.getState().currentGeneration,
      browserCapabilities: this.capabilities,
    };
  }

  /**
   * Register event listener
   */
  on<T extends E2EEClientEventType>(event: T, listener: E2EEClientEventListener<T>): void {
    let eventListeners = this.listeners.get(event);
    if (eventListeners === undefined) {
      eventListeners = new Set();
      this.listeners.set(event, eventListeners);
    }
    eventListeners.add(listener as E2EEClientEventListener<E2EEClientEventType>);
  }

  /**
   * Remove event listener
   */
  off<T extends E2EEClientEventType>(event: T, listener: E2EEClientEventListener<T>): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners !== undefined) {
      eventListeners.delete(listener as E2EEClientEventListener<E2EEClientEventType>);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupEventHandlers(): void {
    // Signaling events
    this.signaling.on('participant-joined', (data) => {
      void this.handleParticipantJoined(data.participantId, data.displayName);
    });

    this.signaling.on('participant-left', (data) => {
      this.handleParticipantLeft(data.participantId);
    });

    this.signaling.on('offer', (data) => {
      void this.handleOffer(data.senderId, data.payload);
    });

    this.signaling.on('answer', (data) => {
      void this.handleAnswer(data.senderId, data.payload);
    });

    this.signaling.on('ice-candidate', (data) => {
      void this.handleIceCandidate(data.senderId, data.payload);
    });

    this.signaling.on('key-exchange', (data) => {
      void this.handleKeyExchange(data.senderId, data.payload);
    });

    this.signaling.on('key-broadcast', (data) => {
      void this.handleKeyBroadcast(data.senderId, data.payload);
    });

    this.signaling.on('disconnected', (data) => {
      this.state = 'disconnected';
      this.emit('disconnected', { reason: data.reason });
    });

    this.signaling.on('error', (data) => {
      this.emit('error', {
        code: data.code,
        message: data.message,
        recoverable: true,
      });
    });

    // Peer manager events
    this.peerManager.on('ice-candidate', (data) => {
      this.signaling.sendIceCandidate(data.participantId, {
        candidate: data.candidate.candidate,
        sdpMid: data.candidate.sdpMid,
        sdpMLineIndex: data.candidate.sdpMLineIndex,
      });
    });

    this.peerManager.on('track', (data) => {
      this.handleRemoteTrack(data.participantId, data.track, data.streams);
    });

    this.peerManager.on('connection-state-change', (data) => {
      const participant = this.participants.get(data.participantId);
      if (participant !== undefined) {
        participant.connectionState = data.state;
      }
    });

    this.peerManager.on('negotiation-needed', (data) => {
      void this.handleNegotiationNeeded(data.participantId);
    });

    // Key manager events
    this.keyManager.on('key-rotated', (data) => {
      this.emit('key-rotated', { generation: data.generation });
      // Broadcast new key to all participants
      void this.broadcastKey();
    });
  }

  private setupEncryptionTransforms(): void {
    // Create key provider from key manager
    const keyProvider: KeyProvider = {
      getEncryptionKey: (): CryptoKey | null => this.keyManager.getState().currentKey,
      getDecryptionKey: (generation: KeyGeneration): CryptoKey | null =>
        this.keyManager.getKeyForGeneration(generation),
      getCurrentGeneration: (): KeyGeneration => this.keyManager.getState().currentGeneration,
    };

    // Set encryption transform factory
    this.peerManager.setEncryptTransformFactory((participantId: string): EncryptionTransform => {
      let processor = this.frameProcessors.get(`encrypt-${participantId}`);
      if (processor === undefined) {
        processor = new FrameProcessor({
          participantId,
          debug: this.config.debug,
        });
        processor.setKeyProvider(keyProvider);
        this.frameProcessors.set(`encrypt-${participantId}`, processor);
      }
      const transform = processor.createEncryptTransform();
      return transform as unknown as EncryptionTransform;
    });

    // Set decryption transform factory
    this.peerManager.setDecryptTransformFactory((participantId: string): EncryptionTransform => {
      let processor = this.frameProcessors.get(`decrypt-${participantId}`);
      if (processor === undefined) {
        processor = new FrameProcessor({
          participantId,
          debug: this.config.debug,
        });
        processor.setKeyProvider(keyProvider);
        this.frameProcessors.set(`decrypt-${participantId}`, processor);
      }
      const transform = processor.createDecryptTransform();
      return transform as unknown as EncryptionTransform;
    });
  }

  private async createPeerConnectionForParticipant(
    participantId: string,
    isInitiator: boolean
  ): Promise<void> {
    this.peerManager.createPeer(participantId);

    // Add local tracks if we have a stream
    if (this.localStream !== null) {
      for (const track of this.localStream.getTracks()) {
        this.peerManager.addTrack(track, this.localStream, participantId);
      }
    }

    // Send our key to the new participant
    await this.sendKeyToParticipant(participantId);

    // If we're the initiator, create and send offer
    if (isInitiator) {
      const offer = await this.peerManager.createOffer(participantId);
      this.signaling.sendOffer(participantId, offer);
    }
  }

  private async handleParticipantJoined(
    participantId: string,
    displayName: string | undefined
  ): Promise<void> {
    const participant: E2EEParticipant = {
      id: participantId,
      displayName,
      encryptionVerified: false,
      connectionState: 'new',
    };

    this.participants.set(participantId, participant);

    // Create peer connection (we're not initiator - new participant will send offer)
    await this.createPeerConnectionForParticipant(participantId, false);

    this.emit('participant-joined', { participant });
    this.log(`Participant joined: ${participantId}`);
  }

  private handleParticipantLeft(participantId: string): void {
    this.peerManager.removePeer(participantId);
    this.participants.delete(participantId);
    this.remoteStreams.delete(participantId);
    this.frameProcessors.delete(`encrypt-${participantId}`);
    this.frameProcessors.delete(`decrypt-${participantId}`);

    this.emit('participant-left', { participantId });
    this.log(`Participant left: ${participantId}`);
  }

  private async handleOffer(
    senderId: string,
    payload: { type: 'offer' | 'answer'; sdp: string }
  ): Promise<void> {
    // Ensure peer exists
    if (!this.peerManager.hasPeer(senderId)) {
      this.peerManager.createPeer(senderId);

      // Add local tracks
      if (this.localStream !== null) {
        for (const track of this.localStream.getTracks()) {
          this.peerManager.addTrack(track, this.localStream, senderId);
        }
      }
    }

    await this.peerManager.setRemoteDescription(senderId, payload);
    const answer = await this.peerManager.createAnswer(senderId);
    this.signaling.sendAnswer(senderId, answer);

    this.log(`Handled offer from ${senderId}`);
  }

  private async handleAnswer(
    senderId: string,
    payload: { type: 'offer' | 'answer'; sdp: string }
  ): Promise<void> {
    await this.peerManager.setRemoteDescription(senderId, payload);
    this.log(`Handled answer from ${senderId}`);
  }

  private async handleIceCandidate(
    senderId: string,
    payload: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }
  ): Promise<void> {
    if (this.peerManager.hasPeer(senderId)) {
      await this.peerManager.addIceCandidate(senderId, payload);
    }
  }

  private async handleKeyExchange(
    senderId: string,
    payload: { key: string; generation: KeyGeneration }
  ): Promise<void> {
    // Decode base64 key to Uint8Array
    const keyBytes = this.base64ToUint8Array(payload.key);

    // Import key from sender
    await this.keyManager.importKey(keyBytes, payload.generation);

    const participant = this.participants.get(senderId);
    if (participant !== undefined) {
      participant.encryptionVerified = true;
      this.emit('encryption-verified', {
        participantId: senderId,
        fingerprint: await this.keyManager.getFormattedFingerprint(),
      });
    }

    this.log(`Received key from ${senderId} (generation ${payload.generation})`);
  }

  private async handleKeyBroadcast(
    senderId: string,
    payload: { key: string; generation: KeyGeneration }
  ): Promise<void> {
    await this.handleKeyExchange(senderId, payload);
  }

  private handleRemoteTrack(
    participantId: string,
    track: MediaStreamTrack,
    streams: readonly MediaStream[]
  ): void {
    // Get or create remote stream for participant
    let stream = this.remoteStreams.get(participantId);

    if (stream === undefined) {
      if (streams.length > 0 && streams[0] !== undefined) {
        stream = streams[0];
      } else {
        stream = new MediaStream([track]);
      }
      this.remoteStreams.set(participantId, stream);
    } else {
      stream.addTrack(track);
    }

    this.emit('remote-stream', { participantId, stream });
    this.log(`Received ${track.kind} track from ${participantId}`);
  }

  private async handleNegotiationNeeded(participantId: string): Promise<void> {
    // Only create offer if we initiated the connection
    const offer = await this.peerManager.createOffer(participantId);
    this.signaling.sendOffer(participantId, offer);
  }

  private async sendKeyToParticipant(participantId: string): Promise<void> {
    const keyData = await this.keyManager.exportCurrentKey();
    const keyBase64 = this.uint8ArrayToBase64(keyData);
    this.signaling.sendKeyExchange(participantId, {
      key: keyBase64,
      generation: this.keyManager.getState().currentGeneration,
    });
  }

  private async broadcastKey(): Promise<void> {
    const keyData = await this.keyManager.exportCurrentKey();
    const keyBase64 = this.uint8ArrayToBase64(keyData);
    this.signaling.broadcastKey({
      key: keyBase64,
      generation: this.keyManager.getState().currentGeneration,
    });
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      const byte = bytes[i];
      if (byte !== undefined) {
        binary += String.fromCharCode(byte);
      }
    }
    return btoa(binary);
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  private emit<T extends E2EEClientEventType>(event: T, data: E2EEClientEventMap[T]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners !== undefined) {
      for (const listener of eventListeners) {
        try {
          (listener as E2EEClientEventListener<T>)(data);
        } catch (error) {
          this.log('Event listener error:', error);
        }
      }
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      // eslint-disable-next-line no-console
      console.log('[E2EEClient]', ...args);
    }
  }
}
