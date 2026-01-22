/**
 * @fileoverview Unit tests for AES-GCM encryption/decryption
 * TDD: Tests written BEFORE implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateEncryptionKey,
  encryptFrame,
  decryptFrame,
  generateIV,
  exportKey,
  importKey,
  constantTimeCompare,
  zeroizeKey,
} from '@core/crypto/aes-gcm';
import type { EncryptedFrame, KeyGeneration } from '@/types';

describe('AES-GCM Crypto Module', () => {
  // =========================================================================
  // Key Generation Tests
  // =========================================================================
  describe('generateEncryptionKey', () => {
    it('should generate a valid AES-GCM-256 key', async () => {
      const key = await generateEncryptionKey();

      expect(key).toBeDefined();
      expect(key.algorithm.name).toBe('AES-GCM');
      expect((key.algorithm as AesKeyGenParams).length).toBe(256);
      expect(key.extractable).toBe(true);
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    });

    it('should generate unique keys each time', async () => {
      const key1 = await generateEncryptionKey();
      const key2 = await generateEncryptionKey();

      const exported1 = await exportKey(key1);
      const exported2 = await exportKey(key2);

      expect(exported1).not.toEqual(exported2);
    });

    it('should throw on crypto API failure', async () => {
      vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValueOnce(new Error('Crypto error'));

      await expect(generateEncryptionKey()).rejects.toThrow();
    });
  });

  // =========================================================================
  // IV Generation Tests
  // =========================================================================
  describe('generateIV', () => {
    it('should generate a 12-byte IV for AES-GCM', () => {
      const iv = generateIV();

      expect(iv).toBeInstanceOf(Uint8Array);
      expect(iv.length).toBe(12);
    });

    it('should generate unique IVs each time', () => {
      const iv1 = generateIV();
      const iv2 = generateIV();

      // Convert to hex for comparison
      const hex1 = Array.from(iv1)
        .map((b) => b.toString(16))
        .join('');
      const hex2 = Array.from(iv2)
        .map((b) => b.toString(16))
        .join('');

      expect(hex1).not.toEqual(hex2);
    });

    it('should never reuse IVs (statistical test)', () => {
      const ivSet = new Set<string>();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        const iv = generateIV();
        const hex = Array.from(iv)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        ivSet.add(hex);
      }

      // All IVs should be unique
      expect(ivSet.size).toBe(iterations);
    });
  });

  // =========================================================================
  // Encryption Tests
  // =========================================================================
  describe('encryptFrame', () => {
    let key: CryptoKey;
    const generation: KeyGeneration = 1;

    beforeEach(async () => {
      key = await generateEncryptionKey();
    });

    it('should encrypt a frame with correct format', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await encryptFrame(plaintext, key, generation);

      expect(encrypted).toBeDefined();
      expect(encrypted.generation).toBe(generation);
      expect(encrypted.iv.length).toBe(12);
      expect(encrypted.ciphertext.length).toBeGreaterThan(plaintext.length);
    });

    it('should produce ciphertext with auth tag (16 bytes longer)', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await encryptFrame(plaintext, key, generation);

      // AES-GCM auth tag is 16 bytes
      expect(encrypted.ciphertext.length).toBe(plaintext.length + 16);
    });

    it('should encrypt empty frames', async () => {
      const plaintext = new Uint8Array([]);

      const encrypted = await encryptFrame(plaintext, key, generation);

      expect(encrypted.ciphertext.length).toBe(16); // Just auth tag
    });

    it('should encrypt large frames (video keyframe)', async () => {
      const plaintext = new Uint8Array(100000); // 100KB frame
      crypto.getRandomValues(plaintext);

      const encrypted = await encryptFrame(plaintext, key, generation);

      expect(encrypted.ciphertext.length).toBe(plaintext.length + 16);
    });

    it('should throw on null key', async () => {
      const plaintext = new Uint8Array([1, 2, 3]);

      await expect(
        encryptFrame(plaintext, null as unknown as CryptoKey, generation)
      ).rejects.toThrow();
    });

    it('should produce different ciphertext for same plaintext (due to random IV)', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted1 = await encryptFrame(plaintext, key, generation);
      const encrypted2 = await encryptFrame(plaintext, key, generation);

      // IVs should be different
      expect(encrypted1.iv).not.toEqual(encrypted2.iv);
      // Ciphertext should be different
      expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext);
    });
  });

  // =========================================================================
  // Decryption Tests
  // =========================================================================
  describe('decryptFrame', () => {
    let key: CryptoKey;
    const generation: KeyGeneration = 1;

    beforeEach(async () => {
      key = await generateEncryptionKey();
    });

    it('should decrypt an encrypted frame correctly', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await encryptFrame(plaintext, key, generation);
      const decrypted = await decryptFrame(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should decrypt empty frames', async () => {
      const plaintext = new Uint8Array([]);

      const encrypted = await encryptFrame(plaintext, key, generation);
      const decrypted = await decryptFrame(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should decrypt large frames', async () => {
      const plaintext = new Uint8Array(100000);
      crypto.getRandomValues(plaintext);

      const encrypted = await encryptFrame(plaintext, key, generation);
      const decrypted = await decryptFrame(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should fail with wrong key', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const wrongKey = await generateEncryptionKey();

      const encrypted = await encryptFrame(plaintext, key, generation);

      await expect(decryptFrame(encrypted, wrongKey)).rejects.toThrow();
    });

    it('should fail with tampered ciphertext', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await encryptFrame(plaintext, key, generation);
      // Tamper with ciphertext
      encrypted.ciphertext[0] ^= 0xff;

      await expect(decryptFrame(encrypted, key)).rejects.toThrow();
    });

    it('should fail with tampered IV', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);

      const encrypted = await encryptFrame(plaintext, key, generation);
      // Tamper with IV
      encrypted.iv[0] ^= 0xff;

      await expect(decryptFrame(encrypted, key)).rejects.toThrow();
    });

    it('should throw on null key', async () => {
      const encrypted: EncryptedFrame = {
        generation: 1,
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array(32),
      };

      await expect(decryptFrame(encrypted, null as unknown as CryptoKey)).rejects.toThrow();
    });
  });

  // =========================================================================
  // Key Import/Export Tests
  // =========================================================================
  describe('exportKey / importKey', () => {
    it('should export and import key correctly', async () => {
      const originalKey = await generateEncryptionKey();

      const exported = await exportKey(originalKey);
      const imported = await importKey(exported);

      // Verify by encrypting/decrypting
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = await encryptFrame(plaintext, originalKey, 1);
      const decrypted = await decryptFrame(encrypted, imported);

      expect(decrypted).toEqual(plaintext);
    });

    it('should export key as raw bytes (32 bytes for AES-256)', async () => {
      const key = await generateEncryptionKey();

      const exported = await exportKey(key);

      expect(exported).toBeInstanceOf(Uint8Array);
      expect(exported.length).toBe(32);
    });

    it('should import key with correct algorithm', async () => {
      const key = await generateEncryptionKey();
      const exported = await exportKey(key);

      const imported = await importKey(exported);

      expect(imported.algorithm.name).toBe('AES-GCM');
      expect((imported.algorithm as AesKeyGenParams).length).toBe(256);
    });

    it('should reject invalid key length', async () => {
      const invalidKey = new Uint8Array(16); // Too short

      await expect(importKey(invalidKey)).rejects.toThrow();
    });
  });

  // =========================================================================
  // Security Tests
  // =========================================================================
  describe('Security Features', () => {
    describe('constant-timeCompare', () => {
      it('should return true for equal arrays', () => {
        const a = new Uint8Array([1, 2, 3, 4, 5]);
        const b = new Uint8Array([1, 2, 3, 4, 5]);

        expect(constantTimeCompare(a, b)).toBe(true);
      });

      it('should return false for different arrays', () => {
        const a = new Uint8Array([1, 2, 3, 4, 5]);
        const b = new Uint8Array([1, 2, 3, 4, 6]);

        expect(constantTimeCompare(a, b)).toBe(false);
      });

      it('should return false for different length arrays', () => {
        const a = new Uint8Array([1, 2, 3]);
        const b = new Uint8Array([1, 2, 3, 4]);

        expect(constantTimeCompare(a, b)).toBe(false);
      });

      it('should take similar time regardless of where difference is', () => {
        const a = new Uint8Array(1000).fill(0);
        const b = new Uint8Array(1000).fill(0);
        const c = new Uint8Array(1000).fill(0);

        b[0] = 1; // Difference at start
        c[999] = 1; // Difference at end

        const iterations = 10000;

        // Time comparison with difference at start
        const startTime1 = performance.now();
        for (let i = 0; i < iterations; i++) {
          constantTimeCompare(a, b);
        }
        const time1 = performance.now() - startTime1;

        // Time comparison with difference at end
        const startTime2 = performance.now();
        for (let i = 0; i < iterations; i++) {
          constantTimeCompare(a, c);
        }
        const time2 = performance.now() - startTime2;

        // Times should be similar (within 20% - generous for test stability)
        const ratio = Math.max(time1, time2) / Math.min(time1, time2);
        expect(ratio).toBeLessThan(1.2);
      });
    });

    describe('zeroizeKey', () => {
      it('should zero out key material', async () => {
        const key = await generateEncryptionKey();
        const exported = await exportKey(key);

        // Store original values
        const originalValues = new Uint8Array(exported);

        zeroizeKey(exported);

        // All bytes should be zero
        expect(exported.every((b) => b === 0)).toBe(true);
        // Should have been different before
        expect(originalValues.some((b) => b !== 0)).toBe(true);
      });

      it('should handle empty arrays', () => {
        const empty = new Uint8Array([]);

        expect(() => zeroizeKey(empty)).not.toThrow();
      });
    });
  });

  // =========================================================================
  // Frame Format Tests
  // =========================================================================
  describe('Frame Format', () => {
    it('should serialize encrypted frame to correct format', async () => {
      const key = await generateEncryptionKey();
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const generation: KeyGeneration = 42;

      const encrypted = await encryptFrame(plaintext, key, generation);

      // Frame format: [Generation (1)][IV (12)][Ciphertext + Tag]
      const serialized = serializeFrame(encrypted);

      expect(serialized[0]).toBe(42); // Generation
      expect(serialized.slice(1, 13)).toEqual(encrypted.iv); // IV
      expect(serialized.slice(13)).toEqual(encrypted.ciphertext); // Ciphertext
    });

    it('should deserialize frame correctly', async () => {
      const key = await generateEncryptionKey();
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const generation: KeyGeneration = 42;

      const encrypted = await encryptFrame(plaintext, key, generation);
      const serialized = serializeFrame(encrypted);
      const deserialized = deserializeFrame(serialized);

      expect(deserialized.generation).toBe(generation);
      expect(deserialized.iv).toEqual(encrypted.iv);
      expect(deserialized.ciphertext).toEqual(encrypted.ciphertext);
    });

    it('should reject frames that are too short', () => {
      const tooShort = new Uint8Array(10); // Less than header size

      expect(() => deserializeFrame(tooShort)).toThrow();
    });
  });
});

// Helper functions that should also be exported from the module
function serializeFrame(frame: EncryptedFrame): Uint8Array {
  const result = new Uint8Array(1 + frame.iv.length + frame.ciphertext.length);
  result[0] = frame.generation;
  result.set(frame.iv, 1);
  result.set(frame.ciphertext, 1 + frame.iv.length);
  return result;
}

function deserializeFrame(data: Uint8Array): EncryptedFrame {
  if (data.length < 13) {
    throw new Error('Frame too short');
  }
  return {
    generation: data[0] as KeyGeneration,
    iv: data.slice(1, 13),
    ciphertext: data.slice(13),
  };
}
