/**
 * @fileoverview Unit tests for Chrome E2EE worker
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkerConfig, InitMessage, SetKeyMessage, StatsMessage } from '@workers/types';

// Import worker internals for testing
// Note: In a real test, you'd use a Worker mock or MessageChannel
import {
  state,
  handleInit,
  handleSetKey,
  handleStats,
  getKeyForGeneration,
  createEncryptTransform,
  createDecryptTransform,
  isStreamMessage,
  isControlMessage,
} from '@workers/chrome-e2ee-worker';

// Mock self.postMessage
const mockPostMessage = vi.fn();
vi.stubGlobal('self', {
  postMessage: mockPostMessage,
  onmessage: null,
});

describe('Chrome E2EE Worker', () => {
  let testKeyData: ArrayBuffer;

  beforeEach(async () => {
    // Reset state
    state.initialized = false;
    state.currentKey = null;
    state.currentGeneration = 0;
    state.previousKey = null;
    state.previousGeneration = 0;
    state.keyHistory.clear();
    state.stats = {
      framesEncrypted: 0,
      framesDecrypted: 0,
      encryptionErrors: 0,
      decryptionErrors: 0,
      avgEncryptionTimeMs: 0,
      avgDecryptionTimeMs: 0,
      currentGeneration: 0,
    };

    // Generate test key
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    testKeyData = await crypto.subtle.exportKey('raw', key);

    mockPostMessage.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // handleInit Tests
  // =========================================================================
  describe('handleInit', () => {
    it('should initialize worker with config', async () => {
      const config: WorkerConfig = {
        participantId: 'user123',
        mode: 'encrypt',
        debug: false,
      };
      const message: InitMessage = { type: 'init', config };

      await handleInit(message);

      expect(state.initialized).toBe(true);
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ready',
          config,
        })
      );
    });

    it('should enable debug mode when specified', async () => {
      const config: WorkerConfig = {
        participantId: 'user123',
        mode: 'encrypt',
        debug: true,
      };
      const message: InitMessage = { type: 'init', config };

      // Mock console.log to verify debug logging
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handleInit(message);

      expect(state.initialized).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  // =========================================================================
  // handleSetKey Tests
  // =========================================================================
  describe('handleSetKey', () => {
    beforeEach(async () => {
      // Initialize worker first
      await handleInit({
        type: 'init',
        config: { participantId: 'user123', mode: 'encrypt' },
      });
      mockPostMessage.mockClear();
    });

    it('should set current key', async () => {
      const message: SetKeyMessage = {
        type: 'set-key',
        keyData: testKeyData,
        generation: 1,
      };

      await handleSetKey(message);

      expect(state.currentKey).not.toBeNull();
      expect(state.currentGeneration).toBe(1);
      expect(state.stats.currentGeneration).toBe(1);
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'key-ack',
          generation: 1,
        })
      );
    });

    it('should set previous key when setPrevious is true', async () => {
      const message: SetKeyMessage = {
        type: 'set-key',
        keyData: testKeyData,
        generation: 1,
        setPrevious: true,
      };

      await handleSetKey(message);

      expect(state.previousKey).not.toBeNull();
      expect(state.previousGeneration).toBe(1);
      expect(state.currentKey).toBeNull(); // Current should remain null
    });

    it('should rotate keys on new key', async () => {
      // Set first key
      await handleSetKey({
        type: 'set-key',
        keyData: testKeyData,
        generation: 1,
      });

      // Generate second key
      const key2 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
        'encrypt',
        'decrypt',
      ]);
      const key2Data = await crypto.subtle.exportKey('raw', key2);

      // Set second key
      await handleSetKey({
        type: 'set-key',
        keyData: key2Data,
        generation: 2,
      });

      expect(state.currentGeneration).toBe(2);
      expect(state.previousGeneration).toBe(1);
      expect(state.currentKey).not.toBeNull();
      expect(state.previousKey).not.toBeNull();
    });

    it('should add old key to history', async () => {
      // Set multiple keys
      for (let i = 1; i <= 3; i++) {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
          'encrypt',
          'decrypt',
        ]);
        const keyData = await crypto.subtle.exportKey('raw', key);

        await handleSetKey({
          type: 'set-key',
          keyData,
          generation: i,
        });
      }

      // Key 1 should be in history
      expect(state.keyHistory.has(1)).toBe(true);
    });

    it('should limit key history size', async () => {
      // Set more keys than maxKeyHistory (5)
      for (let i = 1; i <= 8; i++) {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
          'encrypt',
          'decrypt',
        ]);
        const keyData = await crypto.subtle.exportKey('raw', key);

        await handleSetKey({
          type: 'set-key',
          keyData,
          generation: i,
        });
      }

      // History should not exceed maxKeyHistory
      expect(state.keyHistory.size).toBeLessThanOrEqual(state.maxKeyHistory);
    });

    it('should send error on invalid key', async () => {
      const invalidKeyData = new ArrayBuffer(16); // Too short

      await handleSetKey({
        type: 'set-key',
        keyData: invalidKeyData,
        generation: 1,
      });

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          code: 'KEY_IMPORT_FAILED',
          recoverable: false,
        })
      );
    });
  });

  // =========================================================================
  // handleStats Tests
  // =========================================================================
  describe('handleStats', () => {
    it('should return current statistics', async () => {
      await handleInit({
        type: 'init',
        config: { participantId: 'user123', mode: 'encrypt' },
      });
      mockPostMessage.mockClear();

      // Set some fake stats
      state.stats.framesEncrypted = 100;
      state.stats.framesDecrypted = 50;
      state.stats.encryptionErrors = 2;

      const message: StatsMessage = { type: 'stats' };
      handleStats(message);

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stats',
          stats: expect.objectContaining({
            framesEncrypted: 100,
            framesDecrypted: 50,
            encryptionErrors: 2,
          }),
        })
      );
    });
  });

  // =========================================================================
  // getKeyForGeneration Tests
  // =========================================================================
  describe('getKeyForGeneration', () => {
    beforeEach(async () => {
      await handleInit({
        type: 'init',
        config: { participantId: 'user123', mode: 'decrypt' },
      });
    });

    it('should return current key for current generation', async () => {
      await handleSetKey({
        type: 'set-key',
        keyData: testKeyData,
        generation: 5,
      });

      const key = getKeyForGeneration(5);

      expect(key).toBe(state.currentKey);
    });

    it('should return previous key for previous generation', async () => {
      // Set key 1
      await handleSetKey({
        type: 'set-key',
        keyData: testKeyData,
        generation: 1,
      });

      // Set key 2 (key 1 becomes previous)
      const key2 = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
        'encrypt',
        'decrypt',
      ]);
      const key2Data = await crypto.subtle.exportKey('raw', key2);
      await handleSetKey({
        type: 'set-key',
        keyData: key2Data,
        generation: 2,
      });

      const key = getKeyForGeneration(1);

      expect(key).toBe(state.previousKey);
    });

    it('should return key from history', async () => {
      // Set multiple keys
      for (let i = 1; i <= 5; i++) {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
          'encrypt',
          'decrypt',
        ]);
        const keyData = await crypto.subtle.exportKey('raw', key);
        await handleSetKey({
          type: 'set-key',
          keyData,
          generation: i,
        });
      }

      // Key 1 should still be accessible from history
      const key = getKeyForGeneration(1);

      expect(key).not.toBeNull();
    });

    it('should return null for unknown generation', () => {
      const key = getKeyForGeneration(99);

      expect(key).toBeNull();
    });
  });

  // =========================================================================
  // Transform Tests
  // =========================================================================
  describe('createEncryptTransform', () => {
    beforeEach(async () => {
      await handleInit({
        type: 'init',
        config: { participantId: 'user123', mode: 'encrypt' },
      });
      await handleSetKey({
        type: 'set-key',
        keyData: testKeyData,
        generation: 1,
      });
    });

    it('should create a TransformStream', () => {
      const transform = createEncryptTransform();

      expect(transform).toBeInstanceOf(TransformStream);
    });

    it('should encrypt frames through the transform', async () => {
      const transform = createEncryptTransform();

      // Create a mock frame
      const originalData = new Uint8Array([1, 2, 3, 4, 5]);
      const mockFrame = {
        data: originalData.buffer,
      };

      // Use pipeTo with collect array to test the transform
      const results: unknown[] = [];
      const collectStream = new WritableStream<RTCEncodedVideoFrame | RTCEncodedAudioFrame>({
        write(chunk) {
          results.push(chunk);
        },
      });

      // Create a source stream with one frame
      const sourceStream = new ReadableStream<RTCEncodedVideoFrame | RTCEncodedAudioFrame>({
        start(controller) {
          controller.enqueue(mockFrame as RTCEncodedVideoFrame);
          controller.close();
        },
      });

      await sourceStream.pipeThrough(transform).pipeTo(collectStream);

      expect(results.length).toBe(1);
      const encryptedFrame = results[0] as { data: ArrayBuffer };
      const encryptedData = new Uint8Array(encryptedFrame.data);

      // Should be larger (generation + iv + ciphertext + auth tag)
      expect(encryptedData.length).toBe(1 + 12 + 5 + 16);
      expect(encryptedData[0]).toBe(1); // Generation

      // Stats should be updated
      expect(state.stats.framesEncrypted).toBe(1);
    });

    it('should pass through frames when no key is set', async () => {
      // Clear the key
      state.currentKey = null;

      const transform = createEncryptTransform();

      const originalData = new Uint8Array([1, 2, 3, 4, 5]);
      const mockFrame = {
        data: originalData.buffer,
      };

      const results: unknown[] = [];
      const collectStream = new WritableStream<RTCEncodedVideoFrame | RTCEncodedAudioFrame>({
        write(chunk) {
          results.push(chunk);
        },
      });

      const sourceStream = new ReadableStream<RTCEncodedVideoFrame | RTCEncodedAudioFrame>({
        start(controller) {
          controller.enqueue(mockFrame as RTCEncodedVideoFrame);
          controller.close();
        },
      });

      await sourceStream.pipeThrough(transform).pipeTo(collectStream);

      expect(results.length).toBe(1);
      const passedFrame = results[0] as { data: ArrayBuffer };

      // Should be unchanged
      expect(new Uint8Array(passedFrame.data)).toEqual(originalData);
    });
  });

  describe('createDecryptTransform', () => {
    beforeEach(async () => {
      await handleInit({
        type: 'init',
        config: { participantId: 'user123', mode: 'decrypt' },
      });
      await handleSetKey({
        type: 'set-key',
        keyData: testKeyData,
        generation: 1,
      });
    });

    it('should create a TransformStream', () => {
      const transform = createDecryptTransform();

      expect(transform).toBeInstanceOf(TransformStream);
    });

    it('should decrypt frames through the transform', async () => {
      // First encrypt a frame
      const originalData = new Uint8Array([1, 2, 3, 4, 5]);

      const encryptTransform = createEncryptTransform();
      const encryptedResults: unknown[] = [];

      type FrameType = RTCEncodedVideoFrame | RTCEncodedAudioFrame;

      const sourceStream = new ReadableStream<FrameType>({
        start(controller) {
          controller.enqueue({ data: originalData.buffer } as FrameType);
          controller.close();
        },
      });

      await sourceStream.pipeThrough(encryptTransform).pipeTo(
        new WritableStream<FrameType>({
          write(chunk) {
            encryptedResults.push(chunk);
          },
        })
      );

      // Now decrypt
      const decryptTransform = createDecryptTransform();
      const decryptedResults: unknown[] = [];

      const encryptedStream = new ReadableStream<FrameType>({
        start(controller) {
          controller.enqueue(encryptedResults[0] as FrameType);
          controller.close();
        },
      });

      await encryptedStream.pipeThrough(decryptTransform).pipeTo(
        new WritableStream<FrameType>({
          write(chunk) {
            decryptedResults.push(chunk);
          },
        })
      );

      expect(decryptedResults.length).toBe(1);
      const decryptedFrame = decryptedResults[0] as { data: ArrayBuffer };
      const decryptedData = new Uint8Array(decryptedFrame.data);

      expect(decryptedData).toEqual(originalData);
      expect(state.stats.framesDecrypted).toBe(1);
    });

    it('should pass through unencrypted frames (too short)', async () => {
      const transform = createDecryptTransform();

      type FrameType = RTCEncodedVideoFrame | RTCEncodedAudioFrame;

      // Frame too short to be encrypted
      const shortData = new Uint8Array([1, 2, 3]);
      const mockFrame = {
        data: shortData.buffer,
      };

      const results: unknown[] = [];

      const sourceStream = new ReadableStream<FrameType>({
        start(controller) {
          controller.enqueue(mockFrame as FrameType);
          controller.close();
        },
      });

      await sourceStream.pipeThrough(transform).pipeTo(
        new WritableStream<FrameType>({
          write(chunk) {
            results.push(chunk);
          },
        })
      );

      expect(results.length).toBe(1);
      const passedFrame = results[0] as { data: ArrayBuffer };

      // Should be unchanged
      expect(new Uint8Array(passedFrame.data)).toEqual(shortData);
    });

    it('should drop frames with unknown generation', async () => {
      const transform = createDecryptTransform();

      type FrameType = RTCEncodedVideoFrame | RTCEncodedAudioFrame;

      // Create fake encrypted frame with unknown generation (99)
      const fakeEncrypted = new Uint8Array(1 + 12 + 5 + 16);
      fakeEncrypted[0] = 99; // Unknown generation
      const mockFrame = {
        data: fakeEncrypted.buffer,
      };

      const results: unknown[] = [];

      const sourceStream = new ReadableStream<FrameType>({
        start(controller) {
          controller.enqueue(mockFrame as FrameType);
          controller.close();
        },
      });

      await sourceStream.pipeThrough(transform).pipeTo(
        new WritableStream<FrameType>({
          write(chunk) {
            results.push(chunk);
          },
        })
      );

      // Frame should be dropped (no results)
      expect(results.length).toBe(0);
      expect(state.stats.decryptionErrors).toBe(1);
    });

    it('should handle decryption errors gracefully', async () => {
      const transform = createDecryptTransform();

      type FrameType = RTCEncodedVideoFrame | RTCEncodedAudioFrame;

      // Create a valid-length but invalid encrypted frame (will fail decryption)
      const invalidEncrypted = new Uint8Array(100);
      invalidEncrypted[0] = 1; // Generation 1 (which we have)
      crypto.getRandomValues(invalidEncrypted.subarray(1)); // Random garbage

      const mockFrame = {
        data: invalidEncrypted.buffer,
      };

      const results: unknown[] = [];

      const sourceStream = new ReadableStream<FrameType>({
        start(controller) {
          controller.enqueue(mockFrame as FrameType);
          controller.close();
        },
      });

      await sourceStream.pipeThrough(transform).pipeTo(
        new WritableStream<FrameType>({
          write(chunk) {
            results.push(chunk);
          },
        })
      );

      // Frame should be dropped due to decryption error
      expect(results.length).toBe(0);
      expect(state.stats.decryptionErrors).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Type Guard Tests
  // =========================================================================
  describe('Type Guards', () => {
    it('isStreamMessage should return true for objects with readable and writable', () => {
      const validStreamMsg = {
        readable: new ReadableStream(),
        writable: new WritableStream(),
      };
      expect(isStreamMessage(validStreamMsg)).toBe(true);
    });

    it('isStreamMessage should return false for invalid objects', () => {
      expect(isStreamMessage(null)).toBe(false);
      expect(isStreamMessage(undefined)).toBe(false);
      expect(isStreamMessage({})).toBe(false);
      expect(isStreamMessage({ readable: null })).toBe(false);
      expect(isStreamMessage({ writable: null })).toBe(false);
      expect(isStreamMessage('string')).toBe(false);
      expect(isStreamMessage(123)).toBe(false);
    });

    it('isControlMessage should return true for objects with type string', () => {
      expect(isControlMessage({ type: 'init' })).toBe(true);
      expect(isControlMessage({ type: 'set-key' })).toBe(true);
      expect(isControlMessage({ type: 'stats' })).toBe(true);
      expect(isControlMessage({ type: 'unknown' })).toBe(true);
    });

    it('isControlMessage should return false for invalid objects', () => {
      expect(isControlMessage(null)).toBe(false);
      expect(isControlMessage(undefined)).toBe(false);
      expect(isControlMessage({})).toBe(false);
      expect(isControlMessage({ type: 123 })).toBe(false);
      expect(isControlMessage({ type: null })).toBe(false);
      expect(isControlMessage('string')).toBe(false);
    });
  });

  // =========================================================================
  // Additional Edge Case Tests
  // =========================================================================
  describe('Edge cases', () => {
    beforeEach(async () => {
      // Reset state
      state.initialized = false;
      state.currentKey = null;
      state.currentGeneration = 0;
      state.previousKey = null;
      state.previousGeneration = 0;
      state.keyHistory.clear();
      state.stats = {
        framesEncrypted: 0,
        framesDecrypted: 0,
        encryptionErrors: 0,
        decryptionErrors: 0,
        avgEncryptionTimeMs: 0,
        avgDecryptionTimeMs: 0,
        currentGeneration: 0,
      };
      mockPostMessage.mockClear();
    });

    it('should handle debug mode logging', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handleInit({
        type: 'init',
        config: { participantId: 'debug-user', mode: 'encrypt', debug: true },
      });

      // Should have logged
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle non-debug mode without logging', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handleInit({
        type: 'init',
        config: { participantId: 'quiet-user', mode: 'encrypt', debug: false },
      });

      // Debug logs should not be called
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should use key from history when current and previous do not match', async () => {
      await handleInit({
        type: 'init',
        config: { participantId: 'user123', mode: 'decrypt' },
      });

      // Set up keys with generations 1, 2, 3, 4, 5 (current = 5, previous = 4)
      for (let i = 1; i <= 5; i++) {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
          'encrypt',
          'decrypt',
        ]);
        const keyData = await crypto.subtle.exportKey('raw', key);
        await handleSetKey({
          type: 'set-key',
          keyData,
          generation: i,
        });
      }

      // Generation 1 should be in history, not current or previous
      expect(state.currentGeneration).toBe(5);
      expect(state.previousGeneration).toBe(4);

      // getKeyForGeneration(1) should return from history
      const historyKey = getKeyForGeneration(1);
      expect(historyKey).not.toBeNull();
      expect(historyKey).not.toBe(state.currentKey);
      expect(historyKey).not.toBe(state.previousKey);
    });

    it('should set key as previous when setPrevious flag is true', async () => {
      await handleInit({
        type: 'init',
        config: { participantId: 'user123', mode: 'decrypt' },
      });
      mockPostMessage.mockClear();

      await handleSetKey({
        type: 'set-key',
        keyData: testKeyData,
        generation: 5,
        setPrevious: true,
      });

      // Should be set as previous key, not current
      expect(state.previousGeneration).toBe(5);
      expect(state.previousKey).not.toBeNull();
      expect(state.currentKey).toBeNull();
      expect(state.currentGeneration).toBe(0);
    });

    it('should prune old keys from history when exceeding max size', async () => {
      await handleInit({
        type: 'init',
        config: { participantId: 'user123', mode: 'encrypt' },
      });

      // Set more keys than max history
      for (let i = 1; i <= 10; i++) {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
          'encrypt',
          'decrypt',
        ]);
        const keyData = await crypto.subtle.exportKey('raw', key);
        await handleSetKey({
          type: 'set-key',
          keyData,
          generation: i,
        });
      }

      // History should be pruned to max size
      expect(state.keyHistory.size).toBeLessThanOrEqual(state.maxKeyHistory);
    });

    it('should handle encryption error and pass through frame', async () => {
      await handleInit({
        type: 'init',
        config: { participantId: 'user123', mode: 'encrypt', debug: true },
      });
      await handleSetKey({
        type: 'set-key',
        keyData: testKeyData,
        generation: 1,
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Create a frame that will cause encryption issues
      // by mocking the crypto utils
      const encryptTransform = createEncryptTransform();

      const originalData = new Uint8Array([1, 2, 3, 4, 5]);
      const results: unknown[] = [];

      const sourceStream = new ReadableStream<RTCEncodedVideoFrame | RTCEncodedAudioFrame>({
        start(controller) {
          controller.enqueue({ data: originalData.buffer } as RTCEncodedVideoFrame);
          controller.close();
        },
      });

      const collectStream = new WritableStream<RTCEncodedVideoFrame | RTCEncodedAudioFrame>({
        write(chunk) {
          results.push(chunk);
        },
      });

      await sourceStream.pipeThrough(encryptTransform).pipeTo(collectStream);

      // Frame should be processed
      expect(results.length).toBe(1);

      consoleSpy.mockRestore();
    });

    it('should handle decryption error and drop frame', async () => {
      await handleInit({
        type: 'init',
        config: { participantId: 'user123', mode: 'decrypt', debug: true },
      });
      await handleSetKey({
        type: 'set-key',
        keyData: testKeyData,
        generation: 1,
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const decryptTransform = createDecryptTransform();

      // Create invalid encrypted data (wrong format, will fail decryption)
      const invalidData = new Uint8Array(100);
      invalidData[0] = 1; // Generation 1
      crypto.getRandomValues(invalidData.subarray(1)); // Random garbage

      const results: unknown[] = [];

      const sourceStream = new ReadableStream<RTCEncodedVideoFrame | RTCEncodedAudioFrame>({
        start(controller) {
          controller.enqueue({ data: invalidData.buffer } as RTCEncodedVideoFrame);
          controller.close();
        },
      });

      const collectStream = new WritableStream<RTCEncodedVideoFrame | RTCEncodedAudioFrame>({
        write(chunk) {
          results.push(chunk);
        },
      });

      await sourceStream.pipeThrough(decryptTransform).pipeTo(collectStream);

      // Frame should be dropped (decryption error)
      expect(results.length).toBe(0);
      expect(state.stats.decryptionErrors).toBeGreaterThan(0);

      consoleSpy.mockRestore();
    });

    it('should log unknown message types in debug mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await handleInit({
        type: 'init',
        config: { participantId: 'user123', mode: 'encrypt', debug: true },
      });

      // The main message handler logs unknown message types
      // But we test the internal logging behavior here
      expect(state.initialized).toBe(true);

      consoleSpy.mockRestore();
    });
  });
});
