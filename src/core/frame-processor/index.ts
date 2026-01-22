/**
 * @module core/frame-processor
 * Frame encryption/decryption pipeline for WebRTC media
 *
 * @description
 * Processes WebRTC encoded frames for E2EE encryption and decryption.
 * Works with both Chrome (Insertable Streams) and Safari (RTCRtpScriptTransform).
 *
 * Frame format:
 * [Generation (1 byte)][IV (12 bytes)][Ciphertext + AuthTag (16 bytes)]
 */

import type { KeyGeneration } from '../../types';
import {
  encryptFrame as cryptoEncryptFrame,
  decryptFrame as cryptoDecryptFrame,
  generateIV,
} from '../crypto/aes-gcm';

/** Frame header size: generation (1) + IV (12) = 13 bytes */
export const HEADER_SIZE = 13;

/** IV size for AES-GCM */
export const IV_SIZE = 12;

/** Authentication tag size for AES-GCM */
export const AUTH_TAG_SIZE = 16;

/** Minimum encrypted frame size */
export const MIN_ENCRYPTED_SIZE = HEADER_SIZE + AUTH_TAG_SIZE;

/**
 * Frame metadata extracted from encrypted frames
 */
export interface FrameMetadata {
  /** Key generation used for encryption */
  generation: KeyGeneration;
  /** Initialization vector */
  iv: Uint8Array;
  /** Ciphertext with auth tag */
  ciphertext: Uint8Array;
}

/**
 * Frame processing statistics
 */
export interface FrameProcessorStats {
  /** Number of frames encrypted */
  framesEncrypted: number;
  /** Number of frames decrypted */
  framesDecrypted: number;
  /** Number of frames passed through unencrypted */
  framesPassedThrough: number;
  /** Number of encryption errors */
  encryptionErrors: number;
  /** Number of decryption errors */
  decryptionErrors: number;
  /** Average encryption time in milliseconds */
  avgEncryptionTimeMs: number;
  /** Average decryption time in milliseconds */
  avgDecryptionTimeMs: number;
  /** Current key generation */
  currentGeneration: KeyGeneration;
  /** Bytes encrypted */
  bytesEncrypted: number;
  /** Bytes decrypted */
  bytesDecrypted: number;
}

/**
 * Configuration for FrameProcessor
 */
export interface FrameProcessorConfig {
  /** Participant ID for logging */
  participantId: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Pass through frames when no key is set */
  passThroughWhenNoKey?: boolean;
  /** Drop frames on decryption error (vs pass through) */
  dropOnDecryptionError?: boolean;
}

/**
 * Key provider interface for frame processor
 */
export interface KeyProvider {
  /** Get encryption key for the current generation */
  getEncryptionKey(): CryptoKey | null;
  /** Get decryption key for a specific generation */
  getDecryptionKey(generation: KeyGeneration): CryptoKey | null;
  /** Get current key generation */
  getCurrentGeneration(): KeyGeneration;
}

/**
 * Error callback for frame processing errors
 */
export type FrameErrorCallback = (error: {
  type: 'encryption' | 'decryption';
  message: string;
  recoverable: boolean;
  generation?: KeyGeneration;
}) => void;

/**
 * Processes WebRTC frames for E2EE encryption/decryption
 */
export class FrameProcessor {
  private readonly config: Required<FrameProcessorConfig>;
  private keyProvider: KeyProvider | null = null;
  private errorCallback: FrameErrorCallback | null = null;
  private stats: FrameProcessorStats;

  constructor(config: FrameProcessorConfig) {
    this.config = {
      participantId: config.participantId,
      debug: config.debug ?? false,
      passThroughWhenNoKey: config.passThroughWhenNoKey ?? true,
      dropOnDecryptionError: config.dropOnDecryptionError ?? true,
    };

    this.stats = this.createInitialStats();
  }

  /**
   * Sets the key provider for encryption/decryption
   */
  setKeyProvider(provider: KeyProvider): void {
    this.keyProvider = provider;
    this.stats.currentGeneration = provider.getCurrentGeneration();
  }

  /**
   * Sets the error callback
   */
  onError(callback: FrameErrorCallback): void {
    this.errorCallback = callback;
  }

  /**
   * Encrypts a frame for transmission
   *
   * @param frameData - Raw frame data to encrypt
   * @returns Encrypted frame with header
   */
  async encryptFrame(frameData: Uint8Array): Promise<Uint8Array> {
    const key = this.keyProvider?.getEncryptionKey() ?? null;

    if (key === null) {
      if (this.config.passThroughWhenNoKey) {
        this.stats.framesPassedThrough++;
        return frameData;
      }
      throw new Error('No encryption key available');
    }

    const startTime = performance.now();
    const generation = this.keyProvider!.getCurrentGeneration();

    try {
      const iv = generateIV();
      const ciphertext = await cryptoEncryptFrame(frameData, key, iv);

      // Build encrypted frame: [generation][iv][ciphertext]
      const encrypted = new Uint8Array(1 + IV_SIZE + ciphertext.byteLength);
      encrypted[0] = generation & 0xff;
      encrypted.set(iv, 1);
      encrypted.set(new Uint8Array(ciphertext), 1 + IV_SIZE);

      // Update stats
      this.stats.framesEncrypted++;
      this.stats.bytesEncrypted += frameData.byteLength;
      this.updateAvgTime('encryption', performance.now() - startTime);
      this.stats.currentGeneration = generation;

      return encrypted;
    } catch (error) {
      this.stats.encryptionErrors++;
      this.emitError('encryption', String(error), true, generation);

      // Pass through on error to maintain call continuity
      if (this.config.passThroughWhenNoKey) {
        this.stats.framesPassedThrough++;
        return frameData;
      }
      throw error;
    }
  }

  /**
   * Decrypts an incoming encrypted frame
   *
   * @param encryptedData - Encrypted frame data
   * @returns Decrypted frame data, or null if should be dropped
   */
  async decryptFrame(encryptedData: Uint8Array): Promise<Uint8Array | null> {
    // Check if frame is encrypted (has valid header)
    if (!this.isEncryptedFrame(encryptedData)) {
      // Likely unencrypted frame, pass through
      this.stats.framesPassedThrough++;
      return encryptedData;
    }

    const metadata = this.extractMetadata(encryptedData);
    const key = this.keyProvider?.getDecryptionKey(metadata.generation) ?? null;

    if (key === null) {
      this.stats.decryptionErrors++;
      this.log(`No key for generation ${metadata.generation}`);
      this.emitError(
        'decryption',
        `No key for generation ${metadata.generation}`,
        true,
        metadata.generation
      );

      // Drop frame - can't decrypt without key
      return null;
    }

    const startTime = performance.now();

    try {
      const decrypted = await cryptoDecryptFrame(metadata.ciphertext, key, metadata.iv);

      // Update stats
      this.stats.framesDecrypted++;
      this.stats.bytesDecrypted += decrypted.byteLength;
      this.updateAvgTime('decryption', performance.now() - startTime);

      return decrypted;
    } catch (error) {
      this.stats.decryptionErrors++;
      this.emitError('decryption', String(error), true, metadata.generation);

      if (this.config.dropOnDecryptionError) {
        return null;
      }

      // Return original data (still encrypted, will likely cause issues)
      return encryptedData;
    }
  }

  /**
   * Creates a TransformStream for encryption
   */
  createEncryptTransform(): TransformStream<Uint8Array, Uint8Array> {
    return new TransformStream({
      transform: async (frame, controller) => {
        try {
          const encrypted = await this.encryptFrame(frame);
          controller.enqueue(encrypted);
        } catch (error) {
          this.log('Encrypt transform error:', error);
          // Pass through on error
          controller.enqueue(frame);
        }
      },
    });
  }

  /**
   * Creates a TransformStream for decryption
   */
  createDecryptTransform(): TransformStream<Uint8Array, Uint8Array> {
    return new TransformStream({
      transform: async (frame, controller) => {
        try {
          const decrypted = await this.decryptFrame(frame);
          if (decrypted !== null) {
            controller.enqueue(decrypted);
          }
          // If null, frame is dropped (not enqueued)
        } catch (error) {
          this.log('Decrypt transform error:', error);
          // Drop frame on error
        }
      },
    });
  }

  /**
   * Checks if a frame appears to be encrypted
   */
  isEncryptedFrame(data: Uint8Array): boolean {
    return data.byteLength >= MIN_ENCRYPTED_SIZE;
  }

  /**
   * Extracts metadata from an encrypted frame
   */
  extractMetadata(encrypted: Uint8Array): FrameMetadata {
    if (encrypted.byteLength < MIN_ENCRYPTED_SIZE) {
      throw new Error(`Frame too short: ${encrypted.byteLength} bytes`);
    }

    return {
      generation: encrypted[0] as KeyGeneration,
      iv: encrypted.slice(1, 1 + IV_SIZE),
      ciphertext: encrypted.slice(1 + IV_SIZE),
    };
  }

  /**
   * Gets processing statistics
   */
  getStats(): FrameProcessorStats {
    return { ...this.stats };
  }

  /**
   * Resets statistics
   */
  resetStats(): void {
    this.stats = this.createInitialStats();
    if (this.keyProvider !== null) {
      this.stats.currentGeneration = this.keyProvider.getCurrentGeneration();
    }
  }

  private createInitialStats(): FrameProcessorStats {
    return {
      framesEncrypted: 0,
      framesDecrypted: 0,
      framesPassedThrough: 0,
      encryptionErrors: 0,
      decryptionErrors: 0,
      avgEncryptionTimeMs: 0,
      avgDecryptionTimeMs: 0,
      currentGeneration: 0 as KeyGeneration,
      bytesEncrypted: 0,
      bytesDecrypted: 0,
    };
  }

  private updateAvgTime(type: 'encryption' | 'decryption', timeMs: number): void {
    if (type === 'encryption') {
      const count = this.stats.framesEncrypted;
      this.stats.avgEncryptionTimeMs =
        this.stats.avgEncryptionTimeMs + (timeMs - this.stats.avgEncryptionTimeMs) / count;
    } else {
      const count = this.stats.framesDecrypted;
      this.stats.avgDecryptionTimeMs =
        this.stats.avgDecryptionTimeMs + (timeMs - this.stats.avgDecryptionTimeMs) / count;
    }
  }

  private emitError(
    type: 'encryption' | 'decryption',
    message: string,
    recoverable: boolean,
    generation?: KeyGeneration
  ): void {
    if (this.errorCallback !== null) {
      this.errorCallback({ type, message, recoverable, generation });
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      // eslint-disable-next-line no-console
      console.log(`[FrameProcessor ${this.config.participantId}]`, ...args);
    }
  }
}

/**
 * Creates a simple key provider from a single key
 */
export function createSimpleKeyProvider(
  key: CryptoKey,
  generation: KeyGeneration = 0 as KeyGeneration
): KeyProvider {
  return {
    getEncryptionKey: () => key,
    getDecryptionKey: (gen) => (gen === generation ? key : null),
    getCurrentGeneration: () => generation,
  };
}
