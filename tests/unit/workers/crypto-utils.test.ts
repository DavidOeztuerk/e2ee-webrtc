/**
 * @fileoverview Unit tests for worker crypto utilities
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  importKey,
  generateIV,
  encryptFrame,
  decryptFrame,
  getFrameGeneration,
  isValidFrameLength,
} from '@workers/crypto-utils';
import { HEADER_SIZE, IV_SIZE, AUTH_TAG_SIZE } from '@workers/types';

describe('Worker Crypto Utils', () => {
  let testKey: CryptoKey;
  let testKeyData: ArrayBuffer;

  beforeEach(async () => {
    // Generate a test key
    testKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const exported = await crypto.subtle.exportKey('raw', testKey);
    testKeyData = exported;
  });

  // =========================================================================
  // importKey Tests
  // =========================================================================
  describe('importKey', () => {
    it('should import a valid 32-byte key', async () => {
      const key = await importKey(testKeyData);

      expect(key).toBeDefined();
      expect(key.algorithm.name).toBe('AES-GCM');
      expect((key.algorithm as AesKeyGenParams).length).toBe(256);
    });

    it('should create a key that can encrypt/decrypt', async () => {
      const key = await importKey(testKeyData);
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await encryptFrame(plaintext, key, 1);
      const decrypted = await decryptFrame(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should throw on invalid key length', async () => {
      const shortKey = new ArrayBuffer(16); // Too short

      await expect(importKey(shortKey)).rejects.toThrow();
    });
  });

  // =========================================================================
  // generateIV Tests
  // =========================================================================
  describe('generateIV', () => {
    it('should generate a 12-byte IV', () => {
      const iv = generateIV();

      expect(iv).toBeInstanceOf(Uint8Array);
      expect(iv.length).toBe(IV_SIZE);
    });

    it('should generate unique IVs', () => {
      const iv1 = generateIV();
      const iv2 = generateIV();

      expect(iv1).not.toEqual(iv2);
    });

    it('should generate random IVs (entropy test)', () => {
      const ivs = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const iv = generateIV();
        const hex = Array.from(iv)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        ivs.add(hex);
      }

      // All should be unique
      expect(ivs.size).toBe(100);
    });
  });

  // =========================================================================
  // encryptFrame Tests
  // =========================================================================
  describe('encryptFrame', () => {
    it('should encrypt a frame with correct format', async () => {
      const key = await importKey(testKeyData);
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await encryptFrame(plaintext, key, 42);

      // Format: [Generation (1)][IV (12)][Ciphertext + AuthTag]
      expect(encrypted.length).toBe(1 + IV_SIZE + plaintext.length + AUTH_TAG_SIZE);
      expect(encrypted[0]).toBe(42); // Generation
    });

    it('should handle generation overflow (0-255)', async () => {
      const key = await importKey(testKeyData);
      const plaintext = new Uint8Array([1, 2, 3]);

      // Generation 256 should wrap to 0
      const encrypted = await encryptFrame(plaintext, key, 256);
      expect(encrypted[0]).toBe(0);

      // Generation 300 should wrap to 44
      const encrypted2 = await encryptFrame(plaintext, key, 300);
      expect(encrypted2[0]).toBe(44);
    });

    it('should encrypt empty frames', async () => {
      const key = await importKey(testKeyData);
      const plaintext = new Uint8Array([]);

      const encrypted = await encryptFrame(plaintext, key, 1);

      // Should have header + auth tag (no ciphertext)
      expect(encrypted.length).toBe(HEADER_SIZE + AUTH_TAG_SIZE);
    });

    it('should produce different ciphertext for same plaintext', async () => {
      const key = await importKey(testKeyData);
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted1 = await encryptFrame(plaintext, key, 1);
      const encrypted2 = await encryptFrame(plaintext, key, 1);

      // IVs and ciphertext should be different
      expect(encrypted1).not.toEqual(encrypted2);
    });

    it('should encrypt large frames', async () => {
      const key = await importKey(testKeyData);
      const plaintext = new Uint8Array(60000); // 60KB frame
      crypto.getRandomValues(plaintext);

      const encrypted = await encryptFrame(plaintext, key, 1);

      expect(encrypted.length).toBe(1 + IV_SIZE + plaintext.length + AUTH_TAG_SIZE);
    });
  });

  // =========================================================================
  // decryptFrame Tests
  // =========================================================================
  describe('decryptFrame', () => {
    it('should decrypt an encrypted frame correctly', async () => {
      const key = await importKey(testKeyData);
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await encryptFrame(plaintext, key, 1);
      const decrypted = await decryptFrame(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should decrypt empty frames', async () => {
      const key = await importKey(testKeyData);
      const plaintext = new Uint8Array([]);

      const encrypted = await encryptFrame(plaintext, key, 1);
      const decrypted = await decryptFrame(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should decrypt large frames', async () => {
      const key = await importKey(testKeyData);
      const plaintext = new Uint8Array(60000);
      crypto.getRandomValues(plaintext);

      const encrypted = await encryptFrame(plaintext, key, 1);
      const decrypted = await decryptFrame(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should throw on wrong key', async () => {
      const key1 = await importKey(testKeyData);

      // Generate different key
      const key2Raw = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
        'encrypt',
        'decrypt',
      ]);
      const key2Data = await crypto.subtle.exportKey('raw', key2Raw);
      const key2 = await importKey(key2Data);

      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = await encryptFrame(plaintext, key1, 1);

      await expect(decryptFrame(encrypted, key2)).rejects.toThrow();
    });

    it('should throw on tampered ciphertext', async () => {
      const key = await importKey(testKeyData);
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await encryptFrame(plaintext, key, 1);
      // Tamper with ciphertext (not the header)
      encrypted[HEADER_SIZE] ^= 0xff;

      await expect(decryptFrame(encrypted, key)).rejects.toThrow();
    });

    it('should throw on tampered IV', async () => {
      const key = await importKey(testKeyData);
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await encryptFrame(plaintext, key, 1);
      // Tamper with IV (bytes 1-12)
      encrypted[5] ^= 0xff;

      await expect(decryptFrame(encrypted, key)).rejects.toThrow();
    });

    it('should throw on frame too short', async () => {
      const key = await importKey(testKeyData);
      const tooShort = new Uint8Array(10); // Less than HEADER_SIZE + AUTH_TAG_SIZE

      await expect(decryptFrame(tooShort, key)).rejects.toThrow(/too short/);
    });
  });

  // =========================================================================
  // getFrameGeneration Tests
  // =========================================================================
  describe('getFrameGeneration', () => {
    it('should extract generation from encrypted frame', async () => {
      const key = await importKey(testKeyData);
      const plaintext = new Uint8Array([1, 2, 3]);

      const encrypted = await encryptFrame(plaintext, key, 42);
      const generation = getFrameGeneration(encrypted);

      expect(generation).toBe(42);
    });

    it('should handle generation 0', async () => {
      const key = await importKey(testKeyData);
      const plaintext = new Uint8Array([1, 2, 3]);

      const encrypted = await encryptFrame(plaintext, key, 0);
      const generation = getFrameGeneration(encrypted);

      expect(generation).toBe(0);
    });

    it('should handle generation 255', async () => {
      const key = await importKey(testKeyData);
      const plaintext = new Uint8Array([1, 2, 3]);

      const encrypted = await encryptFrame(plaintext, key, 255);
      const generation = getFrameGeneration(encrypted);

      expect(generation).toBe(255);
    });

    it('should throw on empty frame', () => {
      const empty = new Uint8Array([]);

      expect(() => getFrameGeneration(empty)).toThrow(/empty/);
    });
  });

  // =========================================================================
  // isValidFrameLength Tests
  // =========================================================================
  describe('isValidFrameLength', () => {
    it('should return true for valid length frame', () => {
      // Minimum: HEADER_SIZE (13) + AUTH_TAG_SIZE (16) = 29 bytes
      const validFrame = new Uint8Array(29);

      expect(isValidFrameLength(validFrame)).toBe(true);
    });

    it('should return true for large frames', () => {
      const largeFrame = new Uint8Array(100000);

      expect(isValidFrameLength(largeFrame)).toBe(true);
    });

    it('should return false for frame too short', () => {
      const tooShort = new Uint8Array(28); // One byte too short

      expect(isValidFrameLength(tooShort)).toBe(false);
    });

    it('should return false for empty frame', () => {
      const empty = new Uint8Array([]);

      expect(isValidFrameLength(empty)).toBe(false);
    });
  });

  // =========================================================================
  // Constants Tests
  // =========================================================================
  describe('Constants', () => {
    it('should have correct header size', () => {
      // Generation (1) + IV (12)
      expect(HEADER_SIZE).toBe(13);
    });

    it('should have correct IV size', () => {
      expect(IV_SIZE).toBe(12);
    });

    it('should have correct auth tag size', () => {
      expect(AUTH_TAG_SIZE).toBe(16);
    });
  });
});
