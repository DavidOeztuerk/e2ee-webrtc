/**
 * @module core/key-manager
 * Encryption key management for E2EE WebRTC
 *
 * @description
 * Manages encryption keys with:
 * - Key generation and rotation
 * - Key history for in-flight frame decryption
 * - Automatic key rotation (optional)
 * - Event-based notifications
 * - Secure key zeroization
 */

import type { EncryptionState, KeyGeneration } from '../../types';
import { E2EEError, E2EEErrorCode } from '../../types';
import {
  generateEncryptionKey,
  exportKey,
  importKey,
  zeroizeKey,
  computeKeyFingerprint,
  formatFingerprint as formatFp,
} from '../crypto/aes-gcm';

/** Key manager configuration */
export interface KeyManagerConfig {
  /** Number of previous keys to keep for decryption */
  keyHistorySize: number;
  /** Enable automatic key rotation */
  autoRotate?: boolean;
  /** Interval between key rotations (ms) */
  rotationIntervalMs?: number;
}

/** Key manager events */
export type KeyManagerEventType =
  | 'key-generated'
  | 'key-set'
  | 'key-rotated'
  | 'key-expired'
  | 'destroyed';

/** Event data for key events */
export interface KeyManagerEventData {
  generation: KeyGeneration;
  fingerprint?: Uint8Array;
}

/** Event listener type */
type EventListener = (data: KeyManagerEventData) => void;

/**
 * Manages encryption keys for E2EE
 *
 * @example
 * ```typescript
 * const keyManager = new KeyManager({
 *   keyHistorySize: 5,
 *   autoRotate: true,
 *   rotationIntervalMs: 30000,
 * });
 *
 * // Generate initial key
 * await keyManager.generateKey();
 *
 * // Listen for key events
 * keyManager.on('key-rotated', (data) => {
 *   console.log('Key rotated to generation', data.generation);
 * });
 *
 * // Get key for decryption
 * const key = keyManager.getKeyForGeneration(5);
 * ```
 */
export class KeyManager {
  private config: Required<KeyManagerConfig>;
  private state: EncryptionState;
  private listeners: Map<KeyManagerEventType, Set<EventListener>>;
  private rotationTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(config: KeyManagerConfig) {
    this.config = {
      keyHistorySize: config.keyHistorySize,
      autoRotate: config.autoRotate ?? false,
      rotationIntervalMs: config.rotationIntervalMs ?? 30000,
    };

    this.state = {
      currentKey: null,
      currentGeneration: 0,
      previousKey: null,
      previousGeneration: 0,
      keyHistory: new Map(),
      isActive: false,
    };

    this.listeners = new Map();
  }

  /**
   * Gets a snapshot of the current encryption state
   *
   * @returns Immutable copy of the encryption state
   */
  getState(): EncryptionState {
    return {
      currentKey: this.state.currentKey,
      currentGeneration: this.state.currentGeneration,
      previousKey: this.state.previousKey,
      previousGeneration: this.state.previousGeneration,
      keyHistory: new Map(this.state.keyHistory),
      isActive: this.state.isActive,
    };
  }

  /**
   * Generates a new encryption key
   *
   * @returns The generated CryptoKey
   * @throws {E2EEError} If manager is destroyed or generation fails
   */
  async generateKey(): Promise<CryptoKey> {
    this.ensureNotDestroyed();

    const key = await generateEncryptionKey();
    const newGeneration = this.nextGeneration();

    // Move current to previous
    if (this.state.currentKey) {
      this.state.previousKey = this.state.currentKey;
      this.state.previousGeneration = this.state.currentGeneration;
    }

    // Set new current
    this.state.currentKey = key;
    this.state.currentGeneration = newGeneration;
    this.state.isActive = true;

    // Add to history
    this.addToHistory(key, newGeneration);

    // Start auto-rotation if enabled and this is the first key
    if (this.config.autoRotate && !this.rotationTimer) {
      this.startAutoRotation();
    }

    // Emit event
    this.emit('key-generated', { generation: newGeneration });

    return key;
  }

  /**
   * Sets a key with a specific generation
   *
   * @param key - The CryptoKey to set
   * @param generation - The generation number
   */
  setKey(key: CryptoKey, generation: KeyGeneration): void {
    this.ensureNotDestroyed();

    // Move current to previous
    if (this.state.currentKey) {
      this.state.previousKey = this.state.currentKey;
      this.state.previousGeneration = this.state.currentGeneration;
    }

    // Set new current
    this.state.currentKey = key;
    this.state.currentGeneration = generation;
    this.state.isActive = true;

    // Add to history
    this.addToHistory(key, generation);

    // Emit event
    this.emit('key-set', { generation });
  }

  /**
   * Rotates to a new key
   *
   * @returns The new CryptoKey
   */
  async rotateKey(): Promise<CryptoKey> {
    const key = await this.generateKey();
    this.emit('key-rotated', { generation: this.state.currentGeneration });
    return key;
  }

  /**
   * Gets a key by generation number
   *
   * @param generation - The generation to look up
   * @returns The CryptoKey or null if not found
   */
  getKeyForGeneration(generation: KeyGeneration): CryptoKey | null {
    // Check current key
    if (generation === this.state.currentGeneration) {
      return this.state.currentKey;
    }

    // Check previous key
    if (generation === this.state.previousGeneration) {
      return this.state.previousKey;
    }

    // Check history
    return this.state.keyHistory.get(generation) ?? null;
  }

  /**
   * Exports the current key as bytes
   *
   * @returns 32-byte key material
   * @throws {E2EEError} If no current key exists
   */
  async exportCurrentKey(): Promise<Uint8Array> {
    if (!this.state.currentKey) {
      throw new E2EEError(E2EEErrorCode.KEY_NOT_FOUND, 'No current key to export', false);
    }

    return exportKey(this.state.currentKey);
  }

  /**
   * Imports a key from bytes
   *
   * @param keyData - 32-byte key material
   * @param generation - Generation number
   */
  async importKey(keyData: Uint8Array, generation: KeyGeneration): Promise<void> {
    const key = await importKey(keyData);
    this.setKey(key, generation);
  }

  /**
   * Gets the fingerprint of the current key
   *
   * @returns 32-byte SHA-256 fingerprint
   * @throws {E2EEError} If no current key exists
   */
  async getCurrentKeyFingerprint(): Promise<Uint8Array> {
    if (!this.state.currentKey) {
      throw new E2EEError(E2EEErrorCode.KEY_NOT_FOUND, 'No current key for fingerprint', false);
    }

    const keyBytes = await exportKey(this.state.currentKey);
    const fingerprint = await computeKeyFingerprint(keyBytes);

    // Zeroize key bytes after use
    zeroizeKey(keyBytes);

    return fingerprint;
  }

  /**
   * Gets a formatted fingerprint string
   *
   * @returns Hex string like "AB:CD:EF:..."
   */
  async getFormattedFingerprint(): Promise<string> {
    const fingerprint = await this.getCurrentKeyFingerprint();
    return formatFp(fingerprint);
  }

  /**
   * Clears the key history
   */
  clearHistory(): void {
    this.state.keyHistory.clear();
  }

  /**
   * Registers an event listener
   *
   * @param event - Event type
   * @param listener - Callback function
   */
  on(event: KeyManagerEventType, listener: EventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  /**
   * Removes an event listener
   *
   * @param event - Event type
   * @param listener - Callback function
   */
  off(event: KeyManagerEventType, listener: EventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Registers a one-time event listener
   *
   * @param event - Event type
   * @param listener - Callback function
   */
  once(event: KeyManagerEventType, listener: EventListener): void {
    const onceWrapper: EventListener = (data) => {
      this.off(event, onceWrapper);
      listener(data);
    };
    this.on(event, onceWrapper);
  }

  /**
   * Destroys the key manager and zeroizes all keys
   */
  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    // Stop auto-rotation
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }

    // Zeroize all keys in history
    // Note: We can't actually zeroize CryptoKey objects, but we clear references
    this.state.keyHistory.clear();
    this.state.currentKey = null;
    this.state.previousKey = null;
    this.state.isActive = false;

    // Clear listeners
    this.listeners.clear();

    this.emit('destroyed', { generation: this.state.currentGeneration });
  }

  // Private methods

  private nextGeneration(): KeyGeneration {
    // Wrap at 255 (single byte)
    return (this.state.currentGeneration + 1) & 0xff;
  }

  private addToHistory(key: CryptoKey, generation: KeyGeneration): void {
    this.state.keyHistory.set(generation, key);

    // Evict old keys if history is too large
    if (this.state.keyHistory.size > this.config.keyHistorySize) {
      // Find oldest generation to remove
      const generations = Array.from(this.state.keyHistory.keys());
      const oldest = generations.reduce((min, gen) => {
        // Handle wrap-around
        const diff = (this.state.currentGeneration - gen + 256) % 256;
        const minDiff = (this.state.currentGeneration - min + 256) % 256;
        return diff > minDiff ? gen : min;
      });

      this.state.keyHistory.delete(oldest);
      this.emit('key-expired', { generation: oldest });
    }
  }

  private startAutoRotation(): void {
    this.rotationTimer = setInterval(() => {
      if (!this.destroyed) {
        void this.rotateKey();
      }
    }, this.config.rotationIntervalMs);
  }

  private emit(event: KeyManagerEventType, data: KeyManagerEventData): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (e) {
          console.error(`Error in ${event} listener:`, e);
        }
      }
    }
  }

  private ensureNotDestroyed(): void {
    if (this.destroyed) {
      throw new E2EEError(E2EEErrorCode.UNKNOWN_ERROR, 'KeyManager has been destroyed', false);
    }
  }
}
