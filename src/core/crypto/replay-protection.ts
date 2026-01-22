/**
 * @module core/crypto/replay-protection
 * Replay attack protection for E2EE WebRTC frames
 *
 * @description
 * Provides replay attack protection using:
 * - Monotonically increasing sequence numbers
 * - Sliding window to track seen sequences
 * - Rejection of duplicate or out-of-order frames
 *
 * Frame format with sequence number:
 * [Generation (1 byte)][Sequence (4 bytes)][IV (12 bytes)][Ciphertext + AuthTag]
 */

import { E2EEError, E2EEErrorCode } from '../../types';

/** Default window size for tracking seen sequence numbers */
const DEFAULT_WINDOW_SIZE = 1024;

/** Maximum sequence number before wrap-around (2^32 - 1) */
const MAX_SEQUENCE = 0xffffffff;

/** Sequence number size in bytes */
export const SEQUENCE_SIZE = 4;

/**
 * Configuration for replay protection
 */
export interface ReplayProtectionConfig {
  /** Size of the sliding window (default: 1024) */
  windowSize?: number;
  /** Maximum allowed gap between sequences (default: windowSize * 2) */
  maxGap?: number;
  /** Allow sequence wrap-around (default: true) */
  allowWrapAround?: boolean;
}

/**
 * Statistics for replay protection
 */
export interface ReplayProtectionStats {
  /** Total frames checked */
  framesChecked: number;
  /** Frames accepted */
  framesAccepted: number;
  /** Frames rejected as replay */
  replaysDetected: number;
  /** Frames rejected as too old */
  tooOldRejected: number;
  /** Frames rejected as too far ahead */
  tooFarAheadRejected: number;
  /** Current highest sequence seen */
  highestSequence: number;
}

/**
 * Replay protector for a single sender
 *
 * Uses a sliding window with a Set to track which sequence
 * numbers have been seen. This allows efficient duplicate detection.
 */
export class ReplayProtector {
  private readonly windowSize: number;
  private readonly maxGap: number;
  private readonly allowWrapAround: boolean;

  /** Highest sequence number seen so far */
  private highestSequence: number = -1;

  /** Set of seen sequences within the window */
  private seenSequences = new Set<number>();

  /** Statistics */
  private stats: ReplayProtectionStats = {
    framesChecked: 0,
    framesAccepted: 0,
    replaysDetected: 0,
    tooOldRejected: 0,
    tooFarAheadRejected: 0,
    highestSequence: -1,
  };

  constructor(config: ReplayProtectionConfig = {}) {
    this.windowSize = config.windowSize ?? DEFAULT_WINDOW_SIZE;
    this.maxGap = config.maxGap ?? this.windowSize * 2;
    this.allowWrapAround = config.allowWrapAround ?? true;
  }

  /**
   * Check if a sequence number is valid (not a replay)
   *
   * @param sequence - The sequence number to check
   * @returns true if valid, false if replay or invalid
   */
  check(sequence: number): boolean {
    this.stats.framesChecked++;

    // Validate sequence number
    if (!Number.isInteger(sequence) || sequence < 0 || sequence > MAX_SEQUENCE) {
      return false;
    }

    // First frame - always accept
    if (this.highestSequence === -1) {
      this.accept(sequence);
      return true;
    }

    // Calculate difference from highest seen
    const diff = this.calculateDiff(sequence, this.highestSequence);

    // Too far ahead - potential attack or severe packet reordering
    if (diff > this.maxGap) {
      this.stats.tooFarAheadRejected++;
      return false;
    }

    // Too old - outside the window
    if (diff < -this.windowSize) {
      this.stats.tooOldRejected++;
      return false;
    }

    // Within window - check if already seen
    if (this.seenSequences.has(sequence)) {
      this.stats.replaysDetected++;
      return false;
    }

    // Valid - mark as seen
    this.accept(sequence);
    return true;
  }

  /**
   * Check and throw if replay detected
   *
   * @param sequence - The sequence number to check
   * @throws {E2EEError} If replay attack detected
   */
  checkOrThrow(sequence: number): void {
    if (!this.check(sequence)) {
      throw new E2EEError(
        E2EEErrorCode.REPLAY_DETECTED,
        `Replay attack detected: sequence ${sequence} is invalid or already seen`,
        true
      );
    }
  }

  /**
   * Mark a sequence as seen and update state
   */
  private accept(sequence: number): void {
    // Add to seen set
    this.seenSequences.add(sequence);

    // Update highest if necessary
    if (this.highestSequence === -1 || this.calculateDiff(sequence, this.highestSequence) > 0) {
      this.highestSequence = sequence;
      // Clean up old sequences outside the window
      this.pruneOldSequences();
    }

    this.stats.framesAccepted++;
    this.stats.highestSequence = this.highestSequence;
  }

  /**
   * Remove sequences that are now outside the window
   */
  private pruneOldSequences(): void {
    for (const seq of this.seenSequences) {
      const diff = this.calculateDiff(seq, this.highestSequence);
      if (diff < -this.windowSize) {
        this.seenSequences.delete(seq);
      }
    }
  }

  /**
   * Calculate difference between two sequence numbers
   * Handles wrap-around if enabled
   */
  private calculateDiff(seq1: number, seq2: number): number {
    const diff = seq1 - seq2;

    if (!this.allowWrapAround) {
      return diff;
    }

    // Handle wrap-around: if diff is very negative, sequence might have wrapped
    if (diff < -(MAX_SEQUENCE / 2)) {
      return diff + MAX_SEQUENCE + 1;
    }

    // If diff is very positive, earlier sequence might be from before wrap
    if (diff > MAX_SEQUENCE / 2) {
      return diff - MAX_SEQUENCE - 1;
    }

    return diff;
  }

  /**
   * Get current statistics
   */
  getStats(): ReplayProtectionStats {
    return { ...this.stats };
  }

  /**
   * Reset the protector state
   */
  reset(): void {
    this.highestSequence = -1;
    this.seenSequences.clear();
    this.stats = {
      framesChecked: 0,
      framesAccepted: 0,
      replaysDetected: 0,
      tooOldRejected: 0,
      tooFarAheadRejected: 0,
      highestSequence: -1,
    };
  }
}

/**
 * Manages replay protection for multiple senders
 *
 * Each sender has their own sequence space, so we need
 * separate protectors per sender.
 */
export class ReplayProtectionManager {
  private readonly protectors = new Map<string, ReplayProtector>();
  private readonly config: ReplayProtectionConfig;

  constructor(config: ReplayProtectionConfig = {}) {
    this.config = config;
  }

  /**
   * Check if a frame from a sender is valid
   *
   * @param senderId - The sender's participant ID
   * @param sequence - The frame's sequence number
   * @returns true if valid, false if replay
   */
  check(senderId: string, sequence: number): boolean {
    const protector = this.getOrCreateProtector(senderId);
    return protector.check(sequence);
  }

  /**
   * Check and throw if replay detected
   *
   * @param senderId - The sender's participant ID
   * @param sequence - The frame's sequence number
   * @throws {E2EEError} If replay attack detected
   */
  checkOrThrow(senderId: string, sequence: number): void {
    const protector = this.getOrCreateProtector(senderId);
    protector.checkOrThrow(sequence);
  }

  /**
   * Get statistics for a sender
   */
  getStats(senderId: string): ReplayProtectionStats | undefined {
    return this.protectors.get(senderId)?.getStats();
  }

  /**
   * Get aggregate statistics for all senders
   */
  getAllStats(): Map<string, ReplayProtectionStats> {
    const stats = new Map<string, ReplayProtectionStats>();
    for (const [id, protector] of this.protectors) {
      stats.set(id, protector.getStats());
    }
    return stats;
  }

  /**
   * Remove a sender's protector (when they leave)
   */
  removeSender(senderId: string): void {
    this.protectors.delete(senderId);
  }

  /**
   * Reset all protectors
   */
  reset(): void {
    this.protectors.clear();
  }

  private getOrCreateProtector(senderId: string): ReplayProtector {
    let protector = this.protectors.get(senderId);
    if (protector === undefined) {
      protector = new ReplayProtector(this.config);
      this.protectors.set(senderId, protector);
    }
    return protector;
  }
}

// ============================================================================
// Sequence Number Utilities
// ============================================================================

/** Sequence counter for outgoing frames */
let localSequenceCounter = 0;

/**
 * Get the next sequence number for outgoing frames
 * Automatically wraps around at MAX_SEQUENCE
 */
export function getNextSequence(): number {
  const seq = localSequenceCounter;
  localSequenceCounter = (localSequenceCounter + 1) & MAX_SEQUENCE;
  return seq;
}

/**
 * Reset the local sequence counter
 * Should be called when generating a new key
 */
export function resetSequenceCounter(): void {
  localSequenceCounter = 0;
}

/**
 * Serialize a sequence number to 4 bytes (big-endian)
 */
export function serializeSequence(sequence: number): Uint8Array {
  const bytes = new Uint8Array(SEQUENCE_SIZE);
  bytes[0] = (sequence >>> 24) & 0xff;
  bytes[1] = (sequence >>> 16) & 0xff;
  bytes[2] = (sequence >>> 8) & 0xff;
  bytes[3] = sequence & 0xff;
  return bytes;
}

/**
 * Deserialize a sequence number from 4 bytes (big-endian)
 */
export function deserializeSequence(bytes: Uint8Array, offset: number = 0): number {
  if (bytes.length < offset + SEQUENCE_SIZE) {
    throw new E2EEError(
      E2EEErrorCode.INVALID_FRAME,
      'Frame too short to contain sequence number',
      false
    );
  }
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}
