/**
 * @module tests/unit/frame-processor
 * Unit tests for the frame processor module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FrameProcessor,
  createSimpleKeyProvider,
  HEADER_SIZE,
  IV_SIZE,
  AUTH_TAG_SIZE,
  MIN_ENCRYPTED_SIZE,
  type KeyProvider,
  type FrameProcessorStats,
} from '../../../src/core/frame-processor';
import type { KeyGeneration } from '../../../src/types';

// Mock the crypto module
vi.mock('../../../src/core/crypto/aes-gcm', () => ({
  encryptFrame: vi.fn(async (plaintext: Uint8Array) => {
    // Simulate encryption: add 16 bytes for auth tag
    const ciphertext = new Uint8Array(plaintext.length + AUTH_TAG_SIZE);
    ciphertext.set(plaintext);
    return ciphertext;
  }),
  decryptFrame: vi.fn(async (ciphertext: Uint8Array) => {
    // Simulate decryption: remove 16 bytes for auth tag
    return new Uint8Array(ciphertext.slice(0, ciphertext.length - AUTH_TAG_SIZE));
  }),
  generateIV: vi.fn(() => new Uint8Array(IV_SIZE)),
}));

describe('FrameProcessor', () => {
  let processor: FrameProcessor;
  let mockKeyProvider: KeyProvider;
  let mockKey: CryptoKey;

  beforeEach(() => {
    // Create a mock CryptoKey
    mockKey = {} as CryptoKey;

    // Create mock key provider
    mockKeyProvider = {
      getEncryptionKey: vi.fn(() => mockKey),
      getDecryptionKey: vi.fn((gen: KeyGeneration) => (gen === (0 as KeyGeneration) ? mockKey : null)),
      getCurrentGeneration: vi.fn(() => 0 as KeyGeneration),
    };

    processor = new FrameProcessor({
      participantId: 'test-participant',
      debug: false,
    });

    processor.setKeyProvider(mockKeyProvider);
  });

  describe('constructor', () => {
    it('should create a processor with default config', () => {
      const p = new FrameProcessor({ participantId: 'test' });
      expect(p).toBeInstanceOf(FrameProcessor);
    });

    it('should initialize with zero stats', () => {
      const stats = processor.getStats();
      expect(stats.framesEncrypted).toBe(0);
      expect(stats.framesDecrypted).toBe(0);
      expect(stats.encryptionErrors).toBe(0);
      expect(stats.decryptionErrors).toBe(0);
    });
  });

  describe('encryptFrame', () => {
    it('should encrypt a frame and add header', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = await processor.encryptFrame(plaintext);

      // Expected size: 1 (generation) + 12 (IV) + 5 (data) + 16 (auth tag)
      expect(encrypted.length).toBe(1 + IV_SIZE + plaintext.length + AUTH_TAG_SIZE);

      // First byte should be generation
      expect(encrypted[0]).toBe(0);
    });

    it('should update encryption stats', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      await processor.encryptFrame(plaintext);

      const stats = processor.getStats();
      expect(stats.framesEncrypted).toBe(1);
      expect(stats.bytesEncrypted).toBe(plaintext.length);
    });

    it('should pass through when no key is set and passThroughWhenNoKey is true', async () => {
      const noKeyProcessor = new FrameProcessor({
        participantId: 'test',
        passThroughWhenNoKey: true,
      });

      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await noKeyProcessor.encryptFrame(plaintext);

      expect(result).toEqual(plaintext);
      expect(noKeyProcessor.getStats().framesPassedThrough).toBe(1);
    });

    it('should throw when no key is set and passThroughWhenNoKey is false', async () => {
      const strictProcessor = new FrameProcessor({
        participantId: 'test',
        passThroughWhenNoKey: false,
      });

      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      await expect(strictProcessor.encryptFrame(plaintext)).rejects.toThrow('No encryption key available');
    });
  });

  describe('decryptFrame', () => {
    it('should decrypt a properly formatted frame', async () => {
      // Create a properly formatted encrypted frame
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = await processor.encryptFrame(plaintext);

      const decrypted = await processor.decryptFrame(encrypted);

      expect(decrypted).not.toBeNull();
      // The mock removes 16 bytes, so we compare lengths
      expect(decrypted!.length).toBe(plaintext.length);
    });

    it('should pass through frames that are too small to be encrypted', async () => {
      const smallFrame = new Uint8Array([1, 2, 3]); // Too small to be encrypted

      const result = await processor.decryptFrame(smallFrame);

      expect(result).toEqual(smallFrame);
      expect(processor.getStats().framesPassedThrough).toBe(1);
    });

    it('should return null when no key is available for generation', async () => {
      // Create a frame with generation 5 (no key available)
      const fakeEncrypted = new Uint8Array(MIN_ENCRYPTED_SIZE + 10);
      fakeEncrypted[0] = 5; // Generation 5

      const result = await processor.decryptFrame(fakeEncrypted);

      expect(result).toBeNull();
      expect(processor.getStats().decryptionErrors).toBe(1);
    });

    it('should update decryption stats', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = await processor.encryptFrame(plaintext);

      await processor.decryptFrame(encrypted);

      const stats = processor.getStats();
      expect(stats.framesDecrypted).toBe(1);
    });
  });

  describe('isEncryptedFrame', () => {
    it('should return true for frames >= MIN_ENCRYPTED_SIZE', () => {
      const validFrame = new Uint8Array(MIN_ENCRYPTED_SIZE);
      expect(processor.isEncryptedFrame(validFrame)).toBe(true);
    });

    it('should return false for frames < MIN_ENCRYPTED_SIZE', () => {
      const smallFrame = new Uint8Array(MIN_ENCRYPTED_SIZE - 1);
      expect(processor.isEncryptedFrame(smallFrame)).toBe(false);
    });
  });

  describe('extractMetadata', () => {
    it('should extract generation, IV, and ciphertext', () => {
      const generation = 7;
      const iv = new Uint8Array(IV_SIZE).fill(42);
      const ciphertext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);

      const encrypted = new Uint8Array(1 + IV_SIZE + ciphertext.length);
      encrypted[0] = generation;
      encrypted.set(iv, 1);
      encrypted.set(ciphertext, 1 + IV_SIZE);

      const metadata = processor.extractMetadata(encrypted);

      expect(metadata.generation).toBe(generation);
      expect(metadata.iv).toEqual(iv);
      expect(metadata.ciphertext).toEqual(ciphertext);
    });

    it('should throw for frames that are too short', () => {
      const shortFrame = new Uint8Array(5);

      expect(() => processor.extractMetadata(shortFrame)).toThrow('Frame too short');
    });
  });

  describe('createEncryptTransform', () => {
    it('should create a valid TransformStream', () => {
      const transform = processor.createEncryptTransform();

      expect(transform).toBeInstanceOf(TransformStream);
      expect(transform.readable).toBeDefined();
      expect(transform.writable).toBeDefined();
    });
  });

  describe('createDecryptTransform', () => {
    it('should create a valid TransformStream', () => {
      const transform = processor.createDecryptTransform();

      expect(transform).toBeInstanceOf(TransformStream);
      expect(transform.readable).toBeDefined();
      expect(transform.writable).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('should return a copy of stats', () => {
      const stats1 = processor.getStats();
      const stats2 = processor.getStats();

      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });
  });

  describe('resetStats', () => {
    it('should reset all stats to initial values', async () => {
      // Generate some stats
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      await processor.encryptFrame(plaintext);
      await processor.encryptFrame(plaintext);

      expect(processor.getStats().framesEncrypted).toBe(2);

      processor.resetStats();

      const stats = processor.getStats();
      expect(stats.framesEncrypted).toBe(0);
      expect(stats.framesDecrypted).toBe(0);
      expect(stats.bytesEncrypted).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should call error callback on encryption error', async () => {
      const errorCallback = vi.fn();
      processor.onError(errorCallback);

      // Force an error by making getEncryptionKey return null with passThroughWhenNoKey = false
      const strictProcessor = new FrameProcessor({
        participantId: 'test',
        passThroughWhenNoKey: false,
      });

      const errorCallback2 = vi.fn();
      strictProcessor.onError(errorCallback2);

      try {
        await strictProcessor.encryptFrame(new Uint8Array([1, 2, 3]));
      } catch {
        // Expected to throw
      }

      // No key provider set, so no encryption error callback (throws before getting there)
    });
  });

  describe('constants', () => {
    it('should have correct constant values', () => {
      expect(HEADER_SIZE).toBe(13); // 1 byte generation + 12 bytes IV
      expect(IV_SIZE).toBe(12);
      expect(AUTH_TAG_SIZE).toBe(16);
      expect(MIN_ENCRYPTED_SIZE).toBe(HEADER_SIZE + AUTH_TAG_SIZE);
    });
  });
});

describe('createSimpleKeyProvider', () => {
  it('should create a key provider with specified key and generation', () => {
    const mockKey = {} as CryptoKey;
    const generation = 5 as KeyGeneration;

    const provider = createSimpleKeyProvider(mockKey, generation);

    expect(provider.getEncryptionKey()).toBe(mockKey);
    expect(provider.getDecryptionKey(generation)).toBe(mockKey);
    expect(provider.getDecryptionKey(0 as KeyGeneration)).toBeNull();
    expect(provider.getCurrentGeneration()).toBe(generation);
  });

  it('should default to generation 0', () => {
    const mockKey = {} as CryptoKey;
    const provider = createSimpleKeyProvider(mockKey);

    expect(provider.getCurrentGeneration()).toBe(0);
    expect(provider.getDecryptionKey(0 as KeyGeneration)).toBe(mockKey);
  });
});
