/**
 * @module sfu/participant-manager
 * Participant management for SFU-based group calls
 *
 * @description
 * Manages participants in an SFU room, tracking their state, roles,
 * and encryption status.
 */

import type { ParticipantRole, KeyGeneration } from '../../types';

/**
 * Participant info for SFU room management
 */
export interface ParticipantInfo {
  /** Unique participant ID */
  id: string;
  /** Display name */
  displayName: string;
  /** Role in the session */
  role: ParticipantRole;
  /** When participant joined */
  joinedAt: number;
  /** Audio enabled state */
  audioEnabled: boolean;
  /** Video enabled state */
  videoEnabled: boolean;
  /** Whether participant's key has been received */
  keyReceived: boolean;
  /** Current key generation */
  keyGeneration: KeyGeneration | null;
  /** Last activity timestamp */
  lastActivity: number;
  /** Connection state */
  connectionState: 'connecting' | 'connected' | 'disconnected';
}

/**
 * Configuration for ParticipantManager
 */
export interface ParticipantManagerConfig {
  /** Local participant ID */
  localParticipantId: string;
  /** Maximum participants allowed */
  maxParticipants?: number;
  /** Timeout for inactive participants (ms) */
  inactivityTimeout?: number;
}

/**
 * Event types for ParticipantManager
 */
export type ParticipantEventType =
  | 'participant-joined'
  | 'participant-left'
  | 'participant-updated'
  | 'role-changed'
  | 'connection-state-changed';

/**
 * Event data for ParticipantManager events
 */
export interface ParticipantEventData {
  type: ParticipantEventType;
  participant: ParticipantInfo;
  timestamp: number;
  previousState?: Partial<ParticipantInfo> | undefined;
}

/**
 * Manages participants in an SFU room
 */
export class ParticipantManager {
  private readonly config: Required<ParticipantManagerConfig>;
  private participants: Map<string, ParticipantInfo> = new Map();
  private listeners: Map<ParticipantEventType, Set<(data: ParticipantEventData) => void>> =
    new Map();

  constructor(config: ParticipantManagerConfig) {
    this.config = {
      localParticipantId: config.localParticipantId,
      maxParticipants: config.maxParticipants ?? 50,
      inactivityTimeout: config.inactivityTimeout ?? 30000,
    };
  }

  /**
   * Gets the local participant ID
   */
  get localParticipantId(): string {
    return this.config.localParticipantId;
  }

  /**
   * Gets all participants
   */
  get all(): ParticipantInfo[] {
    return Array.from(this.participants.values());
  }

  /**
   * Gets participant count
   */
  get count(): number {
    return this.participants.size;
  }

  /**
   * Checks if room is at capacity
   */
  get isFull(): boolean {
    return this.participants.size >= this.config.maxParticipants;
  }

  /**
   * Adds or updates a participant
   */
  addParticipant(
    id: string,
    options: {
      displayName?: string;
      role?: ParticipantRole;
      audioEnabled?: boolean;
      videoEnabled?: boolean;
    } = {}
  ): ParticipantInfo {
    if (this.isFull && !this.participants.has(id)) {
      throw new Error(`Room is at capacity (${this.config.maxParticipants})`);
    }

    const existing = this.participants.get(id);
    const isNew = existing === undefined;

    const participant: ParticipantInfo = {
      id,
      displayName: options.displayName ?? existing?.displayName ?? `User ${id.slice(0, 8)}`,
      role: options.role ?? existing?.role ?? 'participant',
      joinedAt: existing?.joinedAt ?? Date.now(),
      audioEnabled: options.audioEnabled ?? existing?.audioEnabled ?? false,
      videoEnabled: options.videoEnabled ?? existing?.videoEnabled ?? false,
      keyReceived: existing?.keyReceived ?? false,
      keyGeneration: existing?.keyGeneration ?? null,
      lastActivity: Date.now(),
      connectionState: existing?.connectionState ?? 'connecting',
    };

    this.participants.set(id, participant);

    this.emit(isNew ? 'participant-joined' : 'participant-updated', {
      participant,
      previousState: existing,
    });

    return participant;
  }

  /**
   * Gets a participant by ID
   */
  getParticipant(id: string): ParticipantInfo | undefined {
    return this.participants.get(id);
  }

  /**
   * Gets the local participant
   */
  getLocalParticipant(): ParticipantInfo | undefined {
    return this.participants.get(this.config.localParticipantId);
  }

  /**
   * Updates a participant's key state
   */
  updateKeyState(id: string, keyGeneration: KeyGeneration): void {
    const participant = this.participants.get(id);
    if (participant === undefined) {
      return;
    }

    const previousState = { ...participant };
    participant.keyReceived = true;
    participant.keyGeneration = keyGeneration;
    participant.lastActivity = Date.now();

    this.emit('participant-updated', { participant, previousState });
  }

  /**
   * Updates a participant's connection state
   */
  updateConnectionState(
    id: string,
    connectionState: 'connecting' | 'connected' | 'disconnected'
  ): void {
    const participant = this.participants.get(id);
    if (participant === undefined) {
      return;
    }

    const previousState = { connectionState: participant.connectionState };
    participant.connectionState = connectionState;
    participant.lastActivity = Date.now();

    this.emit('connection-state-changed', { participant, previousState });
  }

  /**
   * Updates a participant's role
   */
  updateRole(id: string, role: ParticipantRole): void {
    const participant = this.participants.get(id);
    if (participant === undefined) {
      return;
    }

    const previousState = { role: participant.role };
    participant.role = role;
    participant.lastActivity = Date.now();

    this.emit('role-changed', { participant, previousState });
  }

  /**
   * Updates a participant's media state
   */
  updateMediaState(id: string, audio?: boolean, video?: boolean): void {
    const participant = this.participants.get(id);
    if (participant === undefined) {
      return;
    }

    const previousState = {
      audioEnabled: participant.audioEnabled,
      videoEnabled: participant.videoEnabled,
    };

    if (audio !== undefined) {
      participant.audioEnabled = audio;
    }
    if (video !== undefined) {
      participant.videoEnabled = video;
    }
    participant.lastActivity = Date.now();

    this.emit('participant-updated', { participant, previousState });
  }

  /**
   * Removes a participant
   */
  removeParticipant(id: string): boolean {
    const participant = this.participants.get(id);
    if (participant === undefined) {
      return false;
    }

    this.participants.delete(id);
    this.emit('participant-left', { participant });

    return true;
  }

  /**
   * Gets participants with encryption ready (key received)
   */
  getEncryptionReadyParticipants(): ParticipantInfo[] {
    return this.all.filter((p) => p.keyReceived && p.connectionState === 'connected');
  }

  /**
   * Gets participants waiting for keys
   */
  getParticipantsAwaitingKeys(): ParticipantInfo[] {
    return this.all.filter((p) => !p.keyReceived && p.connectionState === 'connected');
  }

  /**
   * Checks if all participants have keys
   */
  allParticipantsReady(): boolean {
    return this.all.every((p) => p.keyReceived || p.connectionState !== 'connected');
  }

  /**
   * Gets inactive participants
   */
  getInactiveParticipants(): ParticipantInfo[] {
    const cutoff = Date.now() - this.config.inactivityTimeout;
    return this.all.filter((p) => p.lastActivity < cutoff);
  }

  /**
   * Removes inactive participants
   */
  pruneInactive(): ParticipantInfo[] {
    const inactive = this.getInactiveParticipants();
    for (const participant of inactive) {
      // Don't prune local participant
      if (participant.id !== this.config.localParticipantId) {
        this.removeParticipant(participant.id);
      }
    }
    return inactive;
  }

  /**
   * Adds an event listener
   */
  on(event: ParticipantEventType, listener: (data: ParticipantEventData) => void): void {
    let listeners = this.listeners.get(event);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener);
  }

  /**
   * Removes an event listener
   */
  off(event: ParticipantEventType, listener: (data: ParticipantEventData) => void): void {
    const listeners = this.listeners.get(event);
    if (listeners !== undefined) {
      listeners.delete(listener);
    }
  }

  /**
   * Clears all participants
   */
  clear(): void {
    this.participants.clear();
  }

  private emit(
    type: ParticipantEventType,
    data: Omit<ParticipantEventData, 'type' | 'timestamp'>
  ): void {
    const listeners = this.listeners.get(type);
    if (listeners !== undefined) {
      const eventData: ParticipantEventData = {
        ...data,
        type,
        timestamp: Date.now(),
      };
      for (const listener of listeners) {
        try {
          listener(eventData);
        } catch {
          // Ignore listener errors
        }
      }
    }
  }
}
