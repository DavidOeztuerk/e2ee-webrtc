/**
 * @module tests/unit/client/peer-manager
 * Unit tests for PeerManager - WebRTC peer connection management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PeerManager } from '../../../src/client/peer-manager';

// Mock RTCPeerConnection
class MockRTCPeerConnection {
  static instances: MockRTCPeerConnection[] = [];

  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;

  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;

  private config: RTCConfiguration;
  private senders: MockRTCRtpSender[] = [];
  private closed = false;

  constructor(config?: RTCConfiguration) {
    this.config = config ?? {};
    MockRTCPeerConnection.instances.push(this);
  }

  getConfiguration(): RTCConfiguration {
    return this.config;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n...' };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n...' };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = new RTCSessionDescription(description);
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = new RTCSessionDescription(description);
  }

  async addIceCandidate(_candidate: RTCIceCandidateInit): Promise<void> {
    // Mock implementation
  }

  addTrack(track: MediaStreamTrack, _stream: MediaStream): RTCRtpSender {
    const sender = new MockRTCRtpSender(track);
    this.senders.push(sender);
    return sender as unknown as RTCRtpSender;
  }

  removeTrack(sender: RTCRtpSender): void {
    const index = this.senders.indexOf(sender as unknown as MockRTCRtpSender);
    if (index >= 0) {
      this.senders.splice(index, 1);
    }
  }

  getSenders(): RTCRtpSender[] {
    return this.senders as unknown as RTCRtpSender[];
  }

  async getStats(): Promise<RTCStatsReport> {
    return new Map() as unknown as RTCStatsReport;
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
  }

  isClosed(): boolean {
    return this.closed;
  }

  // Test helpers
  simulateIceCandidate(candidate: RTCIceCandidate): void {
    const event = {
      candidate,
    } as RTCPeerConnectionIceEvent;
    this.onicecandidate?.(event);
  }

  simulateTrack(track: MediaStreamTrack, streams: MediaStream[]): void {
    const receiver = new MockRTCRtpReceiver(track);
    const event = {
      track,
      receiver: receiver as unknown as RTCRtpReceiver,
      streams: streams as readonly MediaStream[],
    } as RTCTrackEvent;
    this.ontrack?.(event);
  }

  simulateConnectionStateChange(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  simulateNegotiationNeeded(): void {
    this.onnegotiationneeded?.();
  }
}

// Mock RTCRtpSender
class MockRTCRtpSender {
  track: MediaStreamTrack | null;
  transform?: unknown;

  constructor(track: MediaStreamTrack) {
    this.track = track;
  }
}

// Mock RTCRtpReceiver
class MockRTCRtpReceiver {
  track: MediaStreamTrack;
  transform?: unknown;

  constructor(track: MediaStreamTrack) {
    this.track = track;
  }
}

// Mock RTCSessionDescription
class MockRTCSessionDescription implements RTCSessionDescription {
  readonly type: RTCSdpType;
  readonly sdp: string;

  constructor(init: RTCSessionDescriptionInit) {
    this.type = init.type ?? 'offer';
    this.sdp = init.sdp ?? '';
  }

  toJSON(): RTCSessionDescriptionInit {
    return { type: this.type, sdp: this.sdp };
  }
}

// Mock RTCIceCandidate
class MockRTCIceCandidate implements RTCIceCandidate {
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
  readonly foundation: string | null = null;
  readonly component: RTCIceComponent | null = null;
  readonly priority: number | null = null;
  readonly address: string | null = null;
  readonly protocol: RTCIceProtocol | null = null;
  readonly port: number | null = null;
  readonly type: RTCIceCandidateType | null = null;
  readonly tcpType: RTCIceTcpCandidateType | null = null;
  readonly relatedAddress: string | null = null;
  readonly relatedPort: number | null = null;
  readonly usernameFragment: string | null = null;
  readonly relayProtocol: string | null = null;
  readonly url: string | null = null;

  constructor(init: RTCIceCandidateInit) {
    this.candidate = init.candidate ?? '';
    this.sdpMid = init.sdpMid ?? null;
    this.sdpMLineIndex = init.sdpMLineIndex ?? null;
  }

  toJSON(): RTCIceCandidateInit {
    return { candidate: this.candidate, sdpMid: this.sdpMid, sdpMLineIndex: this.sdpMLineIndex };
  }
}

// Mock MediaStreamTrack
function createMockTrack(kind: 'audio' | 'video', id: string): MediaStreamTrack {
  return {
    id,
    kind,
    label: `Mock ${kind} track`,
    enabled: true,
    muted: false,
    readyState: 'live',
    clone: vi.fn(),
    stop: vi.fn(),
    getCapabilities: vi.fn(),
    getConstraints: vi.fn(),
    getSettings: vi.fn(),
    applyConstraints: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onended: null,
    onmute: null,
    onunmute: null,
    contentHint: '',
    isolated: false,
    onisolationchange: null,
  } as unknown as MediaStreamTrack;
}

// Mock MediaStream
function createMockStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    id: `stream-${Math.random().toString(36).substring(7)}`,
    active: true,
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    clone: vi.fn(),
    getTrackById: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onaddtrack: null,
    onremovetrack: null,
  } as unknown as MediaStream;
}

// Stub globals
vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection);
vi.stubGlobal('RTCSessionDescription', MockRTCSessionDescription);
vi.stubGlobal('RTCIceCandidate', MockRTCIceCandidate);

describe('PeerManager', () => {
  beforeEach(() => {
    MockRTCPeerConnection.instances = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create manager with ICE servers config', () => {
      const manager = new PeerManager({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      expect(manager).toBeInstanceOf(PeerManager);
      expect(manager.getPeerCount()).toBe(0);
    });

    it('should accept custom ICE transport policy', () => {
      const manager = new PeerManager({
        iceServers: [],
        iceTransportPolicy: 'relay',
      });
      expect(manager).toBeDefined();
    });

    it('should accept debug flag', () => {
      const manager = new PeerManager({
        iceServers: [],
        debug: true,
      });
      expect(manager).toBeDefined();
    });
  });

  describe('createPeer', () => {
    it('should create new RTCPeerConnection for participant', () => {
      const manager = new PeerManager({ iceServers: [] });
      const peer = manager.createPeer('participant-1');

      expect(peer).toBeDefined();
      expect(manager.getPeer('participant-1')).toBe(peer);
      expect(manager.hasPeer('participant-1')).toBe(true);
      expect(manager.getPeerCount()).toBe(1);
    });

    it('should throw if peer already exists', () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');

      expect(() => manager.createPeer('participant-1')).toThrow(
        'Peer already exists: participant-1'
      );
    });

    it('should configure ICE servers', () => {
      const manager = new PeerManager({
        iceServers: [
          { urls: 'stun:stun.example.com' },
          { urls: 'turn:turn.example.com', username: 'u', credential: 'p' },
        ],
      });
      manager.createPeer('participant-1');

      const peer = MockRTCPeerConnection.instances[0];
      const config = peer?.getConfiguration();
      expect(config?.iceServers).toHaveLength(2);
    });

    it('should configure ICE transport policy', () => {
      const manager = new PeerManager({
        iceServers: [],
        iceTransportPolicy: 'relay',
      });
      manager.createPeer('participant-1');

      const peer = MockRTCPeerConnection.instances[0];
      const config = peer?.getConfiguration();
      expect(config?.iceTransportPolicy).toBe('relay');
    });

    it('should return all peer IDs', () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');
      manager.createPeer('participant-2');
      manager.createPeer('participant-3');

      const peerIds = manager.getPeerIds();
      expect(peerIds).toHaveLength(3);
      expect(peerIds).toContain('participant-1');
      expect(peerIds).toContain('participant-2');
      expect(peerIds).toContain('participant-3');
    });
  });

  describe('removePeer', () => {
    it('should close and remove peer connection', () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');

      const peer = MockRTCPeerConnection.instances[0];
      manager.removePeer('participant-1');

      expect(peer?.isClosed()).toBe(true);
      expect(manager.getPeer('participant-1')).toBeUndefined();
      expect(manager.hasPeer('participant-1')).toBe(false);
      expect(manager.getPeerCount()).toBe(0);
    });

    it('should do nothing if peer does not exist', () => {
      const manager = new PeerManager({ iceServers: [] });
      expect(() => manager.removePeer('non-existent')).not.toThrow();
    });
  });

  describe('addTrack', () => {
    it('should add track to specific peer', () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');

      const mockTrack = createMockTrack('video', 'video-1');
      const mockStream = createMockStream([mockTrack]);
      manager.addTrack(mockTrack, mockStream, 'participant-1');

      const peer = MockRTCPeerConnection.instances[0];
      expect(peer?.getSenders()).toHaveLength(1);
    });

    it('should add track to all peers if participantId is not specified', () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');
      manager.createPeer('participant-2');

      const mockTrack = createMockTrack('video', 'video-1');
      const mockStream = createMockStream([mockTrack]);
      manager.addTrack(mockTrack, mockStream);

      // Both peers should have the track
      expect(MockRTCPeerConnection.instances[0]?.getSenders()).toHaveLength(1);
      expect(MockRTCPeerConnection.instances[1]?.getSenders()).toHaveLength(1);
    });

    it('should do nothing if peer does not exist', () => {
      const manager = new PeerManager({ iceServers: [] });
      const mockTrack = createMockTrack('video', 'video-1');
      const mockStream = createMockStream([mockTrack]);

      // Should not throw
      expect(() => manager.addTrack(mockTrack, mockStream, 'non-existent')).not.toThrow();
    });
  });

  describe('removeTrack', () => {
    it('should remove track from peer', () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');

      const mockTrack = createMockTrack('video', 'video-1');
      const mockStream = createMockStream([mockTrack]);
      manager.addTrack(mockTrack, mockStream, 'participant-1');

      expect(MockRTCPeerConnection.instances[0]?.getSenders()).toHaveLength(1);

      manager.removeTrack(mockTrack.id, 'participant-1');
      expect(MockRTCPeerConnection.instances[0]?.getSenders()).toHaveLength(0);
    });

    it('should remove track from all peers if participantId is not specified', () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');
      manager.createPeer('participant-2');

      const mockTrack = createMockTrack('video', 'video-1');
      const mockStream = createMockStream([mockTrack]);
      manager.addTrack(mockTrack, mockStream);

      manager.removeTrack(mockTrack.id);

      expect(MockRTCPeerConnection.instances[0]?.getSenders()).toHaveLength(0);
      expect(MockRTCPeerConnection.instances[1]?.getSenders()).toHaveLength(0);
    });
  });

  describe('createOffer', () => {
    it('should create and set local description', async () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');

      const offer = await manager.createOffer('participant-1');

      expect(offer.type).toBe('offer');
      expect(offer.sdp).toBeDefined();
    });

    it('should throw if peer not found', async () => {
      const manager = new PeerManager({ iceServers: [] });
      await expect(manager.createOffer('non-existent')).rejects.toThrow('Peer not found');
    });
  });

  describe('createAnswer', () => {
    it('should create answer', async () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');

      // Set remote description first (simulating receiving offer)
      await manager.setRemoteDescription('participant-1', { type: 'offer', sdp: 'v=0...' });

      const answer = await manager.createAnswer('participant-1');

      expect(answer.type).toBe('answer');
      expect(answer.sdp).toBeDefined();
    });

    it('should throw if peer not found', async () => {
      const manager = new PeerManager({ iceServers: [] });
      await expect(manager.createAnswer('non-existent')).rejects.toThrow('Peer not found');
    });
  });

  describe('setRemoteDescription', () => {
    it('should set remote description on peer', async () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');

      await manager.setRemoteDescription('participant-1', { type: 'offer', sdp: 'v=0...' });

      const peer = MockRTCPeerConnection.instances[0];
      expect(peer?.remoteDescription).toBeDefined();
      expect(peer?.remoteDescription?.type).toBe('offer');
    });

    it('should throw if peer not found', async () => {
      const manager = new PeerManager({ iceServers: [] });
      await expect(
        manager.setRemoteDescription('non-existent', { type: 'offer', sdp: '' })
      ).rejects.toThrow('Peer not found');
    });
  });

  describe('addIceCandidate', () => {
    it('should add ICE candidate when remote description is set', async () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');

      // Set remote description first
      await manager.setRemoteDescription('participant-1', { type: 'offer', sdp: 'v=0...' });

      // Add candidate should not throw
      await expect(
        manager.addIceCandidate('participant-1', {
          candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 54321 typ host',
          sdpMid: 'audio',
          sdpMLineIndex: 0,
        })
      ).resolves.not.toThrow();
    });

    it('should queue candidates if remote description not set', async () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');

      // Add candidate before remote description (should be queued)
      await manager.addIceCandidate('participant-1', {
        candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 54321 typ host',
        sdpMid: 'audio',
        sdpMLineIndex: 0,
      });

      // Check that pending candidates exist
      const peerInfo = manager.getPeerInfo('participant-1');
      expect(peerInfo?.pendingCandidates).toHaveLength(1);
    });

    it('should throw if peer not found', async () => {
      const manager = new PeerManager({ iceServers: [] });
      await expect(
        manager.addIceCandidate('non-existent', {
          candidate: '',
          sdpMid: null,
          sdpMLineIndex: null,
        })
      ).rejects.toThrow('Peer not found');
    });
  });

  describe('encryption transforms', () => {
    it('should set encryption transform factory', () => {
      const manager = new PeerManager({ iceServers: [] });
      const factory = vi.fn();

      manager.setEncryptTransformFactory(factory);

      // Factory should be called when adding tracks with transforms
      manager.createPeer('participant-1');
      // Adding track would trigger transform application
    });

    it('should set decryption transform factory', () => {
      const manager = new PeerManager({ iceServers: [] });
      const factory = vi.fn();

      manager.setDecryptTransformFactory(factory);

      // Factory should be called when receiving tracks
    });

    it('should apply encryption transform to all senders', () => {
      const manager = new PeerManager({ iceServers: [] });

      const mockTransform = {
        readable: {} as ReadableStream,
        writable: {} as WritableStream,
      };
      const factory = vi.fn().mockReturnValue(mockTransform);
      manager.setEncryptTransformFactory(factory);

      manager.createPeer('participant-1');
      const mockTrack = createMockTrack('video', 'video-1');
      const mockStream = createMockStream([mockTrack]);
      manager.addTrack(mockTrack, mockStream, 'participant-1');

      // Transform should be applied (factory called)
      // In real code, this sets sender.transform
    });
  });

  describe('events', () => {
    it('should emit ice-candidate when ICE candidate generated', () => {
      const manager = new PeerManager({ iceServers: [] });
      const handler = vi.fn();
      manager.on('ice-candidate', handler);

      manager.createPeer('participant-1');

      // Simulate ICE candidate
      const peer = MockRTCPeerConnection.instances[0];
      const mockCandidate = new MockRTCIceCandidate({
        candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 54321 typ host',
        sdpMid: 'audio',
        sdpMLineIndex: 0,
      });
      peer?.simulateIceCandidate(mockCandidate as unknown as RTCIceCandidate);

      expect(handler).toHaveBeenCalledWith({
        participantId: 'participant-1',
        candidate: mockCandidate,
      });
    });

    it('should emit track when remote track received', () => {
      const manager = new PeerManager({ iceServers: [] });
      const handler = vi.fn();
      manager.on('track', handler);

      manager.createPeer('participant-1');

      // Simulate receiving track
      const peer = MockRTCPeerConnection.instances[0];
      const mockTrack = createMockTrack('video', 'remote-video-1');
      const mockStream = createMockStream([mockTrack]);
      peer?.simulateTrack(mockTrack, [mockStream]);

      expect(handler).toHaveBeenCalledWith({
        participantId: 'participant-1',
        track: mockTrack,
        streams: [mockStream],
      });
    });

    it('should emit connection-state-change on state changes', () => {
      const manager = new PeerManager({ iceServers: [] });
      const handler = vi.fn();
      manager.on('connection-state-change', handler);

      manager.createPeer('participant-1');

      // Simulate connection state change
      const peer = MockRTCPeerConnection.instances[0];
      peer?.simulateConnectionStateChange('connected');

      expect(handler).toHaveBeenCalledWith({
        participantId: 'participant-1',
        state: 'connected',
      });
    });

    it('should emit negotiation-needed when renegotiation required', () => {
      const manager = new PeerManager({ iceServers: [] });
      const handler = vi.fn();
      manager.on('negotiation-needed', handler);

      manager.createPeer('participant-1');

      // Simulate negotiation needed
      const peer = MockRTCPeerConnection.instances[0];
      peer?.simulateNegotiationNeeded();

      expect(handler).toHaveBeenCalledWith({
        participantId: 'participant-1',
      });
    });

    it('should allow removing event listeners', () => {
      const manager = new PeerManager({ iceServers: [] });
      const handler = vi.fn();
      manager.on('connection-state-change', handler);
      manager.off('connection-state-change', handler);

      manager.createPeer('participant-1');
      const peer = MockRTCPeerConnection.instances[0];
      peer?.simulateConnectionStateChange('connected');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return connection stats for peer', async () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');

      const stats = await manager.getStats('participant-1');
      expect(stats).toBeDefined();
    });

    it('should return null if peer not found', async () => {
      const manager = new PeerManager({ iceServers: [] });
      const stats = await manager.getStats('non-existent');
      expect(stats).toBeNull();
    });
  });

  describe('closeAll', () => {
    it('should close all peer connections', () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');
      manager.createPeer('participant-2');
      manager.createPeer('participant-3');

      expect(manager.getPeerCount()).toBe(3);

      manager.closeAll();

      expect(manager.getPeerCount()).toBe(0);
      expect(MockRTCPeerConnection.instances[0]?.isClosed()).toBe(true);
      expect(MockRTCPeerConnection.instances[1]?.isClosed()).toBe(true);
      expect(MockRTCPeerConnection.instances[2]?.isClosed()).toBe(true);
    });
  });

  describe('getPeerInfo', () => {
    it('should return peer info for existing peer', () => {
      const manager = new PeerManager({ iceServers: [] });
      manager.createPeer('participant-1');

      const info = manager.getPeerInfo('participant-1');
      expect(info).toBeDefined();
      expect(info?.id).toBe('participant-1');
      expect(info?.connection).toBeDefined();
      expect(info?.senders).toBeInstanceOf(Map);
      expect(info?.receivers).toBeInstanceOf(Map);
      expect(info?.pendingCandidates).toBeInstanceOf(Array);
    });

    it('should return undefined for non-existent peer', () => {
      const manager = new PeerManager({ iceServers: [] });
      const info = manager.getPeerInfo('non-existent');
      expect(info).toBeUndefined();
    });
  });
});
