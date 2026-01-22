/**
 * @module sfu/sender-keys
 * Sender Key management for SFU-based group encryption
 *
 * @description
 * Implements the Sender Keys protocol for efficient group encryption in SFU topologies.
 * Each participant maintains their own encryption key that all other participants can decrypt.
 *
 * Key features:
 * - Each participant has one sender key for encryption
 * - All participants receive keys from all other participants for decryption
 * - Key rotation is per-participant
 * - Supports ratcheting for forward secrecy
 */

import type { KeyGeneration, SenderKey } from '../../types';
import { generateEncryptionKey, exportKey, importKey } from '../../core/crypto/aes-gcm';

/**
 * Configuration for SenderKeyManager
 */
export interface SenderKeyManagerConfig {
  /** Local participant ID */
  participantId: string;
  /** Enable automatic key ratcheting */
  enableRatcheting?: boolean;
  /** Number of messages before automatic ratchet */
  ratchetInterval?: number;
  /** Maximum stored key generations for decryption */
  maxKeyHistory?: number;
}

/**
 * Event types for SenderKeyManager
 */
export type SenderKeyEventType =
  | 'key-generated'
  | 'key-received'
  | 'key-rotated'
  | 'participant-added'
  | 'participant-removed';

/**
 * Event data for SenderKeyManager events
 */
export interface SenderKeyEventData {
  type: SenderKeyEventType;
  participantId: string;
  generation?: KeyGeneration;
  timestamp: number;
}

/**
 * Serialized sender key for distribution
 */
export interface SerializedSenderKey {
  participantId: string;
  keyData: ArrayBuffer;
  generation: KeyGeneration;
  createdAt: number;
}

/**
 * Manages sender keys for a group encryption session
 */
export class SenderKeyManager {
  private readonly config: Required<SenderKeyManagerConfig>;
  private localKey: SenderKey | null = null;
  private remoteKeys: Map<string, SenderKey[]> = new Map();
  private messageCount = 0;
  private listeners: Map<SenderKeyEventType, Set<(data: SenderKeyEventData) => void>> = new Map();

  constructor(config: SenderKeyManagerConfig) {
    this.config = {
      participantId: config.participantId,
      enableRatcheting: config.enableRatcheting ?? true,
      ratchetInterval: config.ratchetInterval ?? 100,
      maxKeyHistory: config.maxKeyHistory ?? 5,
    };
  }

  /**
   * Gets the local participant ID
   */
  get participantId(): string {
    return this.config.participantId;
  }

  /**
   * Gets the current local sender key
   */
  get currentKey(): SenderKey | null {
    return this.localKey;
  }

  /**
   * Gets all participant IDs with keys
   */
  get participants(): string[] {
    const participants = Array.from(this.remoteKeys.keys());
    if (this.localKey !== null) {
      participants.unshift(this.config.participantId);
    }
    return participants;
  }

  /**
   * Generates or rotates the local sender key
   */
  async generateLocalKey(): Promise<SenderKey> {
    const key = await generateEncryptionKey();
    const generation =
      this.localKey !== null ? (this.localKey.generation + 1) % 256 : (0 as KeyGeneration);

    const senderKey: SenderKey = {
      participantId: this.config.participantId,
      key,
      generation,
      createdAt: Date.now(),
    };

    this.localKey = senderKey;
    this.messageCount = 0;

    this.emit(this.localKey !== null && generation > 0 ? 'key-rotated' : 'key-generated', {
      participantId: this.config.participantId,
      generation,
    });

    return senderKey;
  }

  /**
   * Exports the local key for distribution to other participants
   */
  async exportLocalKey(): Promise<SerializedSenderKey> {
    if (this.localKey === null) {
      throw new Error('No local key generated');
    }

    const keyData = await exportKey(this.localKey.key);

    return {
      participantId: this.config.participantId,
      keyData,
      generation: this.localKey.generation,
      createdAt: this.localKey.createdAt,
    };
  }

  /**
   * Imports a sender key from another participant
   */
  async importRemoteKey(serialized: SerializedSenderKey): Promise<void> {
    if (serialized.participantId === this.config.participantId) {
      throw new Error('Cannot import own key as remote key');
    }

    const keyData = new Uint8Array(serialized.keyData);
    const key = await importKey(keyData);

    const senderKey: SenderKey = {
      participantId: serialized.participantId,
      key,
      generation: serialized.generation,
      createdAt: serialized.createdAt,
    };

    // Store with history
    const existing = this.remoteKeys.get(serialized.participantId) ?? [];
    const isNewParticipant = existing.length === 0;

    // Add new key and maintain history limit
    existing.push(senderKey);
    while (existing.length > this.config.maxKeyHistory) {
      existing.shift();
    }

    this.remoteKeys.set(serialized.participantId, existing);

    this.emit(isNewParticipant ? 'participant-added' : 'key-received', {
      participantId: serialized.participantId,
      generation: serialized.generation,
    });
  }

  /**
   * Gets the encryption key for the local participant
   */
  getEncryptionKey(): CryptoKey | null {
    if (this.localKey === null) {
      return null;
    }

    // Check if ratcheting is needed
    if (this.config.enableRatcheting) {
      this.messageCount++;
      // Note: Actual ratchet would be triggered externally
    }

    return this.localKey.key;
  }

  /**
   * Gets a decryption key for a participant and generation
   */
  getDecryptionKey(participantId: string, generation: KeyGeneration): CryptoKey | null {
    // Local key
    if (participantId === this.config.participantId) {
      if (this.localKey !== null && this.localKey.generation === generation) {
        return this.localKey.key;
      }
      return null;
    }

    // Remote key
    const keys = this.remoteKeys.get(participantId);
    if (keys === undefined) {
      return null;
    }

    const matchingKey = keys.find((k) => k.generation === generation);
    return matchingKey?.key ?? null;
  }

  /**
   * Gets the current generation for a participant
   */
  getGeneration(participantId: string): KeyGeneration | null {
    if (participantId === this.config.participantId) {
      return this.localKey?.generation ?? null;
    }

    const keys = this.remoteKeys.get(participantId);
    if (keys === undefined || keys.length === 0) {
      return null;
    }

    const latestKey = keys[keys.length - 1];
    return latestKey !== undefined ? latestKey.generation : null;
  }

  /**
   * Removes a participant and their keys
   */
  removeParticipant(participantId: string): boolean {
    if (participantId === this.config.participantId) {
      throw new Error('Cannot remove local participant');
    }

    const removed = this.remoteKeys.delete(participantId);

    if (removed) {
      this.emit('participant-removed', { participantId });
    }

    return removed;
  }

  /**
   * Checks if ratcheting is needed based on message count
   */
  shouldRatchet(): boolean {
    return this.config.enableRatcheting && this.messageCount >= this.config.ratchetInterval;
  }

  /**
   * Resets the message count after ratcheting
   */
  resetRatchetCounter(): void {
    this.messageCount = 0;
  }

  /**
   * Adds an event listener
   */
  on(event: SenderKeyEventType, listener: (data: SenderKeyEventData) => void): void {
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
  off(event: SenderKeyEventType, listener: (data: SenderKeyEventData) => void): void {
    const listeners = this.listeners.get(event);
    if (listeners !== undefined) {
      listeners.delete(listener);
    }
  }

  /**
   * Clears all keys and resets state
   */
  clear(): void {
    this.localKey = null;
    this.remoteKeys.clear();
    this.messageCount = 0;
  }

  /**
   * Gets statistics about the key manager
   */
  getStats(): {
    participantCount: number;
    localGeneration: KeyGeneration | null;
    messageCount: number;
    remoteKeyCount: number;
  } {
    let remoteKeyCount = 0;
    for (const keys of this.remoteKeys.values()) {
      remoteKeyCount += keys.length;
    }

    return {
      participantCount: this.participants.length,
      localGeneration: this.localKey?.generation ?? null,
      messageCount: this.messageCount,
      remoteKeyCount,
    };
  }

  private emit(
    type: SenderKeyEventType,
    data: Omit<SenderKeyEventData, 'type' | 'timestamp'>
  ): void {
    const listeners = this.listeners.get(type);
    if (listeners !== undefined) {
      const eventData: SenderKeyEventData = {
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
