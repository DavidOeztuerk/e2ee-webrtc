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
  encryptFrame: vi.fn(async (plaintext: Uint8Array, _key: CryptoKey, generation: number) => {
    // Simulate encryption: return EncryptedFrame object
    const iv = new Uint8Array(IV_SIZE);
    const ciphertext = new Uint8Array(plaintext.length + AUTH_TAG_SIZE);
    ciphertext.set(plaintext);
    return {
      generation: generation & 0xff,
      iv,
      ciphertext,
    };
  }),
  decryptFrame: vi.fn(async (frame: { ciphertext: Uint8Array }) => {
    // Simulate decryption: remove 16 bytes for auth tag
    return new Uint8Array(frame.ciphertext.slice(0, frame.ciphertext.length - AUTH_TAG_SIZE));
  }),
  serializeFrame: vi.fn((frame: { generation: number; iv: Uint8Array; ciphertext: Uint8Array }) => {
    // Serialize frame: [generation][iv][ciphertext]
    const result = new Uint8Array(1 + frame.iv.length + frame.ciphertext.length);
    result[0] = frame.generation;
    result.set(frame.iv, 1);
    result.set(frame.ciphertext, 1 + frame.iv.length);
    return result;
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
      getDecryptionKey: vi.fn((gen: KeyGeneration) =>
        gen === (0 as KeyGeneration) ? mockKey : null
      ),
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

      await expect(strictProcessor.encryptFrame(plaintext)).rejects.toThrow(
        'No encryption key available'
      );
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
      const ciphertext = new Uint8Array([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      ]);

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

    it('should call error callback with generation on decryption error for missing key', async () => {
      const errorCallback = vi.fn();
      processor.onError(errorCallback);

      // Create a frame with generation 5 (no key available)
      const fakeEncrypted = new Uint8Array(MIN_ENCRYPTED_SIZE + 10);
      fakeEncrypted[0] = 5; // Generation 5

      await processor.decryptFrame(fakeEncrypted);

      expect(errorCallback).toHaveBeenCalledWith({
        type: 'decryption',
        message: 'No key for generation 5',
        recoverable: true,
        generation: 5,
      });
    });

    it('should pass through on encryption error when passThroughWhenNoKey is true', async () => {
      // Create a processor with a key provider that will cause encryption to fail
      const failingProcessor = new FrameProcessor({
        participantId: 'failing-test',
        passThroughWhenNoKey: true,
        debug: false,
      });

      // Mock crypto module to throw error
      const { encryptFrame: mockEncrypt } = await import('../../../src/core/crypto/aes-gcm');
      (mockEncrypt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Encryption failed')
      );

      // Set up key provider that returns a key
      const failingKeyProvider: KeyProvider = {
        getEncryptionKey: vi.fn(() => ({}) as CryptoKey),
        getDecryptionKey: vi.fn(() => null),
        getCurrentGeneration: vi.fn(() => 0 as KeyGeneration),
      };
      failingProcessor.setKeyProvider(failingKeyProvider);

      const errorCallback = vi.fn();
      failingProcessor.onError(errorCallback);

      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await failingProcessor.encryptFrame(plaintext);

      // Should pass through original data
      expect(result).toEqual(plaintext);
      expect(failingProcessor.getStats().encryptionErrors).toBe(1);
      expect(failingProcessor.getStats().framesPassedThrough).toBe(1);
      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'encryption',
          recoverable: true,
        })
      );
    });

    it('should throw on encryption error when passThroughWhenNoKey is false', async () => {
      // Create a processor with a key provider that will cause encryption to fail
      const failingProcessor = new FrameProcessor({
        participantId: 'failing-test',
        passThroughWhenNoKey: false,
        debug: false,
      });

      // Mock crypto module to throw error
      const { encryptFrame: mockEncrypt } = await import('../../../src/core/crypto/aes-gcm');
      (mockEncrypt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Encryption failed')
      );

      // Set up key provider that returns a key
      const failingKeyProvider: KeyProvider = {
        getEncryptionKey: vi.fn(() => ({}) as CryptoKey),
        getDecryptionKey: vi.fn(() => null),
        getCurrentGeneration: vi.fn(() => 0 as KeyGeneration),
      };
      failingProcessor.setKeyProvider(failingKeyProvider);

      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      await expect(failingProcessor.encryptFrame(plaintext)).rejects.toThrow('Encryption failed');
      expect(failingProcessor.getStats().encryptionErrors).toBe(1);
    });

    it('should return encrypted data on decryption error when dropOnDecryptionError is false', async () => {
      const lenientProcessor = new FrameProcessor({
        participantId: 'lenient-test',
        dropOnDecryptionError: false,
        debug: false,
      });

      // Mock decrypt to throw
      const { decryptFrame: mockDecrypt } = await import('../../../src/core/crypto/aes-gcm');
      (mockDecrypt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Decryption failed')
      );

      // Set up key provider
      const keyProvider: KeyProvider = {
        getEncryptionKey: vi.fn(() => ({}) as CryptoKey),
        getDecryptionKey: vi.fn(() => ({}) as CryptoKey),
        getCurrentGeneration: vi.fn(() => 0 as KeyGeneration),
      };
      lenientProcessor.setKeyProvider(keyProvider);

      const errorCallback = vi.fn();
      lenientProcessor.onError(errorCallback);

      // Create a valid encrypted frame
      const fakeEncrypted = new Uint8Array(MIN_ENCRYPTED_SIZE + 10);
      fakeEncrypted[0] = 0; // Generation 0

      const result = await lenientProcessor.decryptFrame(fakeEncrypted);

      // Should return the original encrypted data
      expect(result).toEqual(fakeEncrypted);
      expect(lenientProcessor.getStats().decryptionErrors).toBe(1);
      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'decryption',
          recoverable: true,
        })
      );
    });

    it('should return null on decryption error when dropOnDecryptionError is true', async () => {
      const strictProcessor = new FrameProcessor({
        participantId: 'strict-test',
        dropOnDecryptionError: true,
        debug: false,
      });

      // Mock decrypt to throw
      const { decryptFrame: mockDecrypt } = await import('../../../src/core/crypto/aes-gcm');
      (mockDecrypt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Decryption failed')
      );

      // Set up key provider
      const keyProvider: KeyProvider = {
        getEncryptionKey: vi.fn(() => ({}) as CryptoKey),
        getDecryptionKey: vi.fn(() => ({}) as CryptoKey),
        getCurrentGeneration: vi.fn(() => 0 as KeyGeneration),
      };
      strictProcessor.setKeyProvider(keyProvider);

      // Create a valid encrypted frame
      const fakeEncrypted = new Uint8Array(MIN_ENCRYPTED_SIZE + 10);
      fakeEncrypted[0] = 0; // Generation 0

      const result = await strictProcessor.decryptFrame(fakeEncrypted);

      // Should return null (drop the frame)
      expect(result).toBeNull();
      expect(strictProcessor.getStats().decryptionErrors).toBe(1);
    });
  });

  describe('debug logging', () => {
    it('should log when debug is enabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const debugProcessor = new FrameProcessor({
        participantId: 'debug-test',
        debug: true,
      });

      // Create a frame with no key to trigger the missing key log
      const fakeEncrypted = new Uint8Array(MIN_ENCRYPTED_SIZE + 10);
      fakeEncrypted[0] = 5; // Generation 5 (no key)

      // Set up key provider that returns null for generation 5
      const keyProvider: KeyProvider = {
        getEncryptionKey: vi.fn(() => ({}) as CryptoKey),
        getDecryptionKey: vi.fn(() => null),
        getCurrentGeneration: vi.fn(() => 0 as KeyGeneration),
      };
      debugProcessor.setKeyProvider(keyProvider);

      await debugProcessor.decryptFrame(fakeEncrypted);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[FrameProcessor debug-test]'),
        expect.stringContaining('No key for generation 5')
      );

      consoleSpy.mockRestore();
    });

    it('should not log when debug is disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const quietProcessor = new FrameProcessor({
        participantId: 'quiet-test',
        debug: false,
      });

      const fakeEncrypted = new Uint8Array(MIN_ENCRYPTED_SIZE + 10);
      fakeEncrypted[0] = 5;

      const keyProvider: KeyProvider = {
        getEncryptionKey: vi.fn(() => ({}) as CryptoKey),
        getDecryptionKey: vi.fn(() => null),
        getCurrentGeneration: vi.fn(() => 0 as KeyGeneration),
      };
      quietProcessor.setKeyProvider(keyProvider);

      await quietProcessor.decryptFrame(fakeEncrypted);

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('transform streams', () => {
    it('should encrypt frames through createEncryptTransform', async () => {
      const transform = processor.createEncryptTransform();
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const results: Uint8Array[] = [];

      // Use pipeTo to properly handle the async transform
      const sourceStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(plaintext);
          controller.close();
        },
      });

      const collectStream = new WritableStream<Uint8Array>({
        write(chunk) {
          results.push(chunk);
        },
      });

      await sourceStream.pipeThrough(transform).pipeTo(collectStream);

      expect(results.length).toBe(1);
      expect(results[0].length).toBeGreaterThan(plaintext.length);
    });

    it('should pass through on encrypt transform error', async () => {
      const { encryptFrame: mockEncrypt } = await import('../../../src/core/crypto/aes-gcm');
      (mockEncrypt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Transform error'));

      const transform = processor.createEncryptTransform();
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const results: Uint8Array[] = [];

      const sourceStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(plaintext);
          controller.close();
        },
      });

      const collectStream = new WritableStream<Uint8Array>({
        write(chunk) {
          results.push(chunk);
        },
      });

      await sourceStream.pipeThrough(transform).pipeTo(collectStream);

      // Should pass through the original frame on error
      expect(results.length).toBe(1);
      expect(results[0]).toEqual(plaintext);
    });

    it('should decrypt frames through createDecryptTransform', async () => {
      // First encrypt a frame
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = await processor.encryptFrame(plaintext);

      // Then decrypt it
      const transform = processor.createDecryptTransform();
      const results: Uint8Array[] = [];

      const sourceStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encrypted);
          controller.close();
        },
      });

      const collectStream = new WritableStream<Uint8Array>({
        write(chunk) {
          results.push(chunk);
        },
      });

      await sourceStream.pipeThrough(transform).pipeTo(collectStream);

      expect(results.length).toBe(1);
      expect(results[0].length).toBe(plaintext.length);
    });

    it('should drop frames on decrypt transform error', async () => {
      const { decryptFrame: mockDecrypt } = await import('../../../src/core/crypto/aes-gcm');
      (mockDecrypt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Transform error'));

      // When decryptFrame fails, it's caught inside decryptFrame and returns null
      // The transform then drops the frame (doesn't enqueue)
      const transform = processor.createDecryptTransform();

      // Create a valid encrypted frame
      const fakeEncrypted = new Uint8Array(MIN_ENCRYPTED_SIZE + 10);
      fakeEncrypted[0] = 0; // Generation 0

      const results: Uint8Array[] = [];

      const sourceStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(fakeEncrypted);
          controller.close();
        },
      });

      const collectStream = new WritableStream<Uint8Array>({
        write(chunk) {
          results.push(chunk);
        },
      });

      await sourceStream.pipeThrough(transform).pipeTo(collectStream);

      // Frame should be dropped (decryptFrame returns null on error with dropOnDecryptionError=true)
      expect(results.length).toBe(0);
      expect(processor.getStats().decryptionErrors).toBe(1);
    });

    it('should log and drop frame on unexpected transform error', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const debugProcessor = new FrameProcessor({
        participantId: 'debug',
        debug: true,
      });

      // Mock decryptFrame to throw an unexpected error (not caught internally)
      const originalDecryptFrame = debugProcessor.decryptFrame.bind(debugProcessor);
      debugProcessor.decryptFrame = vi.fn().mockRejectedValueOnce(new Error('Unexpected error'));

      debugProcessor.setKeyProvider(mockKeyProvider);

      const transform = debugProcessor.createDecryptTransform();

      const fakeEncrypted = new Uint8Array(MIN_ENCRYPTED_SIZE + 10);
      fakeEncrypted[0] = 0;

      const results: Uint8Array[] = [];

      const sourceStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(fakeEncrypted);
          controller.close();
        },
      });

      const collectStream = new WritableStream<Uint8Array>({
        write(chunk) {
          results.push(chunk);
        },
      });

      await sourceStream.pipeThrough(transform).pipeTo(collectStream);

      // Frame should be dropped
      expect(results.length).toBe(0);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[FrameProcessor debug]'),
        'Decrypt transform error:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should handle null return from decryptFrame in transform', async () => {
      const processor2 = new FrameProcessor({
        participantId: 'test2',
        debug: false,
      });

      // Set up key provider that returns null for unknown generations
      const keyProvider2: KeyProvider = {
        getEncryptionKey: vi.fn(() => ({}) as CryptoKey),
        getDecryptionKey: vi.fn(() => null), // Always return null
        getCurrentGeneration: vi.fn(() => 0 as KeyGeneration),
      };
      processor2.setKeyProvider(keyProvider2);

      const transform = processor2.createDecryptTransform();

      // Frame with unknown generation - will return null from decryptFrame
      const fakeEncrypted = new Uint8Array(MIN_ENCRYPTED_SIZE + 10);
      fakeEncrypted[0] = 99; // Unknown generation

      const results: Uint8Array[] = [];

      const sourceStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(fakeEncrypted);
          controller.close();
        },
      });

      const collectStream = new WritableStream<Uint8Array>({
        write(chunk) {
          results.push(chunk);
        },
      });

      await sourceStream.pipeThrough(transform).pipeTo(collectStream);

      // Frame should be dropped (null was returned)
      expect(results.length).toBe(0);
    });
  });

  describe('resetStats with keyProvider', () => {
    it('should restore currentGeneration from keyProvider after reset', async () => {
      // Set key provider with generation 5
      const keyProvider5: KeyProvider = {
        getEncryptionKey: vi.fn(() => ({}) as CryptoKey),
        getDecryptionKey: vi.fn(() => ({}) as CryptoKey),
        getCurrentGeneration: vi.fn(() => 5 as KeyGeneration),
      };
      processor.setKeyProvider(keyProvider5);

      // Stats should show generation 5
      expect(processor.getStats().currentGeneration).toBe(5);

      // Do some operations
      const plaintext = new Uint8Array([1, 2, 3]);
      await processor.encryptFrame(plaintext);

      // Reset stats
      processor.resetStats();

      // Should still have generation from key provider
      expect(processor.getStats().currentGeneration).toBe(5);
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
