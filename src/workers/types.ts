/**
 * @module workers/types
 * Type definitions for E2EE transform workers
 */

import type { KeyGeneration, WorkerStats } from '../types';

/** Header size: generation (1) + IV (12) */
export const HEADER_SIZE = 13;

/** IV size for AES-GCM */
export const IV_SIZE = 12;

/** AES-GCM auth tag size */
export const AUTH_TAG_SIZE = 16;

/**
 * Frame metadata for tracking
 */
export interface FrameMetadata {
  /** Synchronization source identifier */
  ssrc?: number;
  /** Frame timestamp */
  timestamp?: number;
  /** Frame type (e.g., 'key', 'delta') */
  type?: string;
}

/**
 * Worker operation mode
 */
export type WorkerMode = 'encrypt' | 'decrypt';

/**
 * Worker configuration
 */
export interface WorkerConfig {
  /** Participant ID */
  participantId: string;
  /** Operation mode */
  mode: WorkerMode;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Worker state
 */
export interface WorkerState {
  /** Is worker initialized */
  initialized: boolean;
  /** Current encryption key */
  currentKey: CryptoKey | null;
  /** Current key generation */
  currentGeneration: KeyGeneration;
  /** Previous key for decryption */
  previousKey: CryptoKey | null;
  /** Previous key generation */
  previousGeneration: KeyGeneration;
  /** Key history for multi-key support */
  keyHistory: Map<KeyGeneration, CryptoKey>;
  /** Maximum keys to keep in history */
  maxKeyHistory: number;
  /** Statistics */
  stats: WorkerStats;
}

/**
 * Message types for worker communication
 */
export type WorkerMessageType =
  | 'init'
  | 'set-key'
  | 'transform'
  | 'stats'
  | 'error'
  | 'ready'
  | 'key-ack';

/**
 * Base worker message
 */
export interface BaseWorkerMessage {
  type: WorkerMessageType;
  id?: string;
}

/**
 * Initialize worker message
 */
export interface InitMessage extends BaseWorkerMessage {
  type: 'init';
  config: WorkerConfig;
}

/**
 * Set encryption key message
 */
export interface SetKeyMessage extends BaseWorkerMessage {
  type: 'set-key';
  /** Raw key bytes (32 bytes for AES-256) */
  keyData: ArrayBuffer;
  /** Key generation number */
  generation: KeyGeneration;
  /** Set as previous key (for decryption overlap) */
  setPrevious?: boolean;
}

/**
 * Transform request message (for testing)
 */
export interface TransformMessage extends BaseWorkerMessage {
  type: 'transform';
  data: ArrayBuffer;
}

/**
 * Stats request message
 */
export interface StatsMessage extends BaseWorkerMessage {
  type: 'stats';
}

/**
 * Ready acknowledgment message
 */
export interface ReadyMessage extends BaseWorkerMessage {
  type: 'ready';
  config: WorkerConfig;
}

/**
 * Key acknowledgment message
 */
export interface KeyAckMessage extends BaseWorkerMessage {
  type: 'key-ack';
  generation: KeyGeneration;
}

/**
 * Error message from worker
 */
export interface ErrorMessage extends BaseWorkerMessage {
  type: 'error';
  code: string;
  message: string;
  recoverable: boolean;
  details?: unknown;
}

/**
 * Stats response message
 */
export interface StatsResponseMessage extends BaseWorkerMessage {
  type: 'stats';
  stats: WorkerStats;
}

/**
 * Union type for all worker messages
 */
export type WorkerMessage =
  | InitMessage
  | SetKeyMessage
  | TransformMessage
  | StatsMessage
  | ReadyMessage
  | KeyAckMessage
  | ErrorMessage
  | StatsResponseMessage;
