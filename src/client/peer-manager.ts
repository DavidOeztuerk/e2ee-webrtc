/**
 * @module client/peer-manager
 * WebRTC peer connection management
 *
 * @description
 * Manages RTCPeerConnection instances for each remote participant.
 * Handles:
 * - Peer connection lifecycle
 * - ICE candidate gathering and relay
 * - Track management (add/remove)
 * - Encryption transforms (Insertable Streams / Script Transform)
 */

// ============================================================================
// Types
// ============================================================================

/**
 * ICE server configuration
 */
export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Peer manager configuration
 */
export interface PeerManagerConfig {
  /** ICE servers for STUN/TURN */
  iceServers: IceServerConfig[];
  /** ICE transport policy */
  iceTransportPolicy?: RTCIceTransportPolicy;
  /** Debug logging */
  debug?: boolean;
}

/**
 * Peer connection info
 */
export interface PeerInfo {
  id: string;
  connection: RTCPeerConnection;
  senders: Map<string, RTCRtpSender>;
  receivers: Map<string, RTCRtpReceiver>;
  pendingCandidates: RTCIceCandidateInit[];
  hasRemoteDescription: boolean;
}

/**
 * SDP description
 */
export interface SDPDescription {
  type: 'offer' | 'answer';
  sdp: string;
}

/**
 * ICE candidate info
 */
export interface ICECandidateInfo {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

/**
 * Encryption transform interface
 */
export interface EncryptionTransform {
  readable: ReadableStream<RTCEncodedVideoFrame | RTCEncodedAudioFrame>;
  writable: WritableStream<RTCEncodedVideoFrame | RTCEncodedAudioFrame>;
}

/**
 * Event types
 */
export type PeerManagerEventType =
  | 'ice-candidate'
  | 'track'
  | 'connection-state-change'
  | 'negotiation-needed';

/**
 * Event data map
 */
export interface PeerManagerEventMap {
  'ice-candidate': { participantId: string; candidate: RTCIceCandidate };
  track: { participantId: string; track: MediaStreamTrack; streams: readonly MediaStream[] };
  'connection-state-change': { participantId: string; state: RTCPeerConnectionState };
  'negotiation-needed': { participantId: string };
}

/**
 * Event listener type
 */
type PeerManagerEventListener<T extends PeerManagerEventType> = (
  data: PeerManagerEventMap[T]
) => void;

// ============================================================================
// PeerManager Class
// ============================================================================

/**
 * Manages WebRTC peer connections for all participants
 */
export class PeerManager {
  private readonly config: Required<PeerManagerConfig>;
  private readonly peers = new Map<string, PeerInfo>();
  private readonly listeners = new Map<
    PeerManagerEventType,
    Set<PeerManagerEventListener<PeerManagerEventType>>
  >();

  // Encryption transform factory (set by E2EEClient)
  private encryptTransformFactory: ((participantId: string) => EncryptionTransform) | null = null;
  private decryptTransformFactory: ((participantId: string) => EncryptionTransform) | null = null;

  constructor(config: PeerManagerConfig) {
    this.config = {
      iceServers: config.iceServers,
      iceTransportPolicy: config.iceTransportPolicy ?? 'all',
      debug: config.debug ?? false,
    };
  }

  /**
   * Create a new peer connection for a participant
   */
  createPeer(participantId: string): RTCPeerConnection {
    if (this.peers.has(participantId)) {
      throw new Error(`Peer already exists: ${participantId}`);
    }

    const connection = new RTCPeerConnection({
      iceServers: this.config.iceServers,
      iceTransportPolicy: this.config.iceTransportPolicy,
    });

    const peerInfo: PeerInfo = {
      id: participantId,
      connection,
      senders: new Map(),
      receivers: new Map(),
      pendingCandidates: [],
      hasRemoteDescription: false,
    };

    this.peers.set(participantId, peerInfo);
    this.setupPeerEventHandlers(peerInfo);

    this.log(`Created peer connection for ${participantId}`);
    return connection;
  }

  /**
   * Get peer connection for participant
   */
  getPeer(participantId: string): RTCPeerConnection | undefined {
    return this.peers.get(participantId)?.connection;
  }

  /**
   * Get peer info for participant
   */
  getPeerInfo(participantId: string): PeerInfo | undefined {
    return this.peers.get(participantId);
  }

  /**
   * Check if peer exists
   */
  hasPeer(participantId: string): boolean {
    return this.peers.has(participantId);
  }

  /**
   * Get all peer IDs
   */
  getPeerIds(): string[] {
    return Array.from(this.peers.keys());
  }

  /**
   * Get peer count
   */
  getPeerCount(): number {
    return this.peers.size;
  }

  /**
   * Remove and close peer connection
   */
  removePeer(participantId: string): void {
    const peerInfo = this.peers.get(participantId);
    if (peerInfo === undefined) {
      return;
    }

    peerInfo.connection.close();
    this.peers.delete(participantId);
    this.log(`Removed peer connection for ${participantId}`);
  }

  /**
   * Add track to peer(s)
   */
  addTrack(track: MediaStreamTrack, stream: MediaStream, participantId?: string): void {
    if (participantId !== undefined) {
      const peerInfo = this.peers.get(participantId);
      if (peerInfo !== undefined) {
        this.addTrackToPeer(peerInfo, track, stream);
      }
    } else {
      // Add to all peers
      for (const peerInfo of this.peers.values()) {
        this.addTrackToPeer(peerInfo, track, stream);
      }
    }
  }

  /**
   * Remove track from peer(s)
   */
  removeTrack(trackId: string, participantId?: string): void {
    if (participantId !== undefined) {
      const peerInfo = this.peers.get(participantId);
      if (peerInfo !== undefined) {
        this.removeTrackFromPeer(peerInfo, trackId);
      }
    } else {
      // Remove from all peers
      for (const peerInfo of this.peers.values()) {
        this.removeTrackFromPeer(peerInfo, trackId);
      }
    }
  }

  /**
   * Create offer for peer
   */
  async createOffer(participantId: string): Promise<SDPDescription> {
    const peerInfo = this.peers.get(participantId);
    if (peerInfo === undefined) {
      throw new Error(`Peer not found: ${participantId}`);
    }

    const offer = await peerInfo.connection.createOffer();
    await peerInfo.connection.setLocalDescription(offer);

    return {
      type: 'offer',
      sdp: offer.sdp ?? '',
    };
  }

  /**
   * Create answer for peer
   */
  async createAnswer(participantId: string): Promise<SDPDescription> {
    const peerInfo = this.peers.get(participantId);
    if (peerInfo === undefined) {
      throw new Error(`Peer not found: ${participantId}`);
    }

    const answer = await peerInfo.connection.createAnswer();
    await peerInfo.connection.setLocalDescription(answer);

    return {
      type: 'answer',
      sdp: answer.sdp ?? '',
    };
  }

  /**
   * Set remote description for peer
   */
  async setRemoteDescription(participantId: string, description: SDPDescription): Promise<void> {
    const peerInfo = this.peers.get(participantId);
    if (peerInfo === undefined) {
      throw new Error(`Peer not found: ${participantId}`);
    }

    await peerInfo.connection.setRemoteDescription(
      new RTCSessionDescription({
        type: description.type,
        sdp: description.sdp,
      })
    );

    peerInfo.hasRemoteDescription = true;

    // Process pending ICE candidates
    for (const candidate of peerInfo.pendingCandidates) {
      await peerInfo.connection.addIceCandidate(new RTCIceCandidate(candidate));
    }
    peerInfo.pendingCandidates = [];
  }

  /**
   * Add ICE candidate for peer
   */
  async addIceCandidate(participantId: string, candidate: ICECandidateInfo): Promise<void> {
    const peerInfo = this.peers.get(participantId);
    if (peerInfo === undefined) {
      throw new Error(`Peer not found: ${participantId}`);
    }

    const candidateInit: RTCIceCandidateInit = {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
    };

    if (peerInfo.hasRemoteDescription) {
      await peerInfo.connection.addIceCandidate(new RTCIceCandidate(candidateInit));
    } else {
      // Queue candidate until remote description is set
      peerInfo.pendingCandidates.push(candidateInit);
    }
  }

  /**
   * Set encryption transform factory
   */
  setEncryptTransformFactory(factory: (participantId: string) => EncryptionTransform): void {
    this.encryptTransformFactory = factory;
  }

  /**
   * Set decryption transform factory
   */
  setDecryptTransformFactory(factory: (participantId: string) => EncryptionTransform): void {
    this.decryptTransformFactory = factory;
  }

  /**
   * Apply encryption transform to all senders for a peer
   */
  applyEncryptionTransform(participantId: string): void {
    const peerInfo = this.peers.get(participantId);
    if (peerInfo === undefined || this.encryptTransformFactory === null) {
      return;
    }

    for (const sender of peerInfo.senders.values()) {
      this.applyTransformToSender(sender, participantId);
    }
  }

  /**
   * Apply decryption transform to all receivers for a peer
   */
  applyDecryptionTransform(participantId: string): void {
    const peerInfo = this.peers.get(participantId);
    if (peerInfo === undefined || this.decryptTransformFactory === null) {
      return;
    }

    for (const receiver of peerInfo.receivers.values()) {
      this.applyTransformToReceiver(receiver, participantId);
    }
  }

  /**
   * Get WebRTC stats for peer
   */
  async getStats(participantId: string): Promise<RTCStatsReport | null> {
    const peerInfo = this.peers.get(participantId);
    if (peerInfo === undefined) {
      return null;
    }

    return peerInfo.connection.getStats();
  }

  /**
   * Close all peer connections
   */
  closeAll(): void {
    for (const participantId of this.peers.keys()) {
      this.removePeer(participantId);
    }
  }

  /**
   * Register event listener
   */
  on<T extends PeerManagerEventType>(event: T, listener: PeerManagerEventListener<T>): void {
    let eventListeners = this.listeners.get(event);
    if (eventListeners === undefined) {
      eventListeners = new Set();
      this.listeners.set(event, eventListeners);
    }
    eventListeners.add(listener as PeerManagerEventListener<PeerManagerEventType>);
  }

  /**
   * Remove event listener
   */
  off<T extends PeerManagerEventType>(event: T, listener: PeerManagerEventListener<T>): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners !== undefined) {
      eventListeners.delete(listener as PeerManagerEventListener<PeerManagerEventType>);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupPeerEventHandlers(peerInfo: PeerInfo): void {
    const { connection, id: participantId } = peerInfo;

    connection.onicecandidate = (event: RTCPeerConnectionIceEvent): void => {
      if (event.candidate !== null) {
        this.emit('ice-candidate', {
          participantId,
          candidate: event.candidate,
        });
      }
    };

    connection.ontrack = (event: RTCTrackEvent): void => {
      // Store receiver
      peerInfo.receivers.set(event.track.id, event.receiver);

      // Apply decryption transform if available
      if (this.decryptTransformFactory !== null) {
        this.applyTransformToReceiver(event.receiver, participantId);
      }

      this.emit('track', {
        participantId,
        track: event.track,
        streams: event.streams,
      });
    };

    connection.onconnectionstatechange = (): void => {
      this.emit('connection-state-change', {
        participantId,
        state: connection.connectionState,
      });
    };

    connection.onnegotiationneeded = (): void => {
      this.emit('negotiation-needed', { participantId });
    };
  }

  private addTrackToPeer(peerInfo: PeerInfo, track: MediaStreamTrack, stream: MediaStream): void {
    const sender = peerInfo.connection.addTrack(track, stream);
    peerInfo.senders.set(track.id, sender);

    // Apply encryption transform if available
    if (this.encryptTransformFactory !== null) {
      this.applyTransformToSender(sender, peerInfo.id);
    }

    this.log(`Added ${track.kind} track to peer ${peerInfo.id}`);
  }

  private removeTrackFromPeer(peerInfo: PeerInfo, trackId: string): void {
    const sender = peerInfo.senders.get(trackId);
    if (sender !== undefined) {
      peerInfo.connection.removeTrack(sender);
      peerInfo.senders.delete(trackId);
      this.log(`Removed track ${trackId} from peer ${peerInfo.id}`);
    }
  }

  private applyTransformToSender(sender: RTCRtpSender, participantId: string): void {
    if (this.encryptTransformFactory === null) {
      return;
    }

    // Check if Encoded Transform API is supported
    if ('transform' in sender) {
      const transform = this.encryptTransformFactory(participantId);
      // Use type assertion as TypeScript doesn't know about the transform property
      (sender as RTCRtpSender & { transform: EncryptionTransform }).transform = transform;
      this.log(`Applied encryption transform to sender for ${participantId}`);
    }
  }

  private applyTransformToReceiver(receiver: RTCRtpReceiver, participantId: string): void {
    if (this.decryptTransformFactory === null) {
      return;
    }

    // Check if Encoded Transform API is supported
    if ('transform' in receiver) {
      const transform = this.decryptTransformFactory(participantId);
      // Use type assertion as TypeScript doesn't know about the transform property
      (receiver as RTCRtpReceiver & { transform: EncryptionTransform }).transform = transform;
      this.log(`Applied decryption transform to receiver for ${participantId}`);
    }
  }

  private emit<T extends PeerManagerEventType>(event: T, data: PeerManagerEventMap[T]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners !== undefined) {
      for (const listener of eventListeners) {
        try {
          (listener as PeerManagerEventListener<T>)(data);
        } catch (error) {
          this.log('Event listener error:', error);
        }
      }
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      // eslint-disable-next-line no-console
      console.log('[PeerManager]', ...args);
    }
  }
}
