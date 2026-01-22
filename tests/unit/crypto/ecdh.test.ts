/**
 * @fileoverview Unit tests for ECDH key exchange
 * TDD: Tests written BEFORE implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateKeyPair,
  deriveSharedSecret,
  exportPublicKey,
  importPublicKey,
  computeFingerprint,
  formatFingerprint,
  deriveEncryptionKey,
} from '@core/crypto/ecdh';

describe('ECDH Key Exchange Module', () => {
  // =========================================================================
  // Key Pair Generation Tests
  // =========================================================================
  describe('generateKeyPair', () => {
    it('should generate a valid ECDH P-256 key pair', async () => {
      const keyPair = await generateKeyPair();

      expect(keyPair).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey.algorithm.name).toBe('ECDH');
      expect((keyPair.publicKey.algorithm as EcKeyGenParams).namedCurve).toBe('P-256');
    });

    it('should generate unique key pairs each time', async () => {
      const keyPair1 = await generateKeyPair();
      const keyPair2 = await generateKeyPair();

      const exported1 = await exportPublicKey(keyPair1.publicKey);
      const exported2 = await exportPublicKey(keyPair2.publicKey);

      expect(exported1).not.toEqual(exported2);
    });

    it('should have extractable public key but non-extractable private key', async () => {
      const keyPair = await generateKeyPair();

      expect(keyPair.publicKey.extractable).toBe(true);
      expect(keyPair.privateKey.extractable).toBe(false);
    });

    it('should have correct key usages', async () => {
      const keyPair = await generateKeyPair();

      expect(keyPair.privateKey.usages).toContain('deriveBits');
      expect(keyPair.publicKey.usages).toEqual([]);
    });
  });

  // =========================================================================
  // Shared Secret Derivation Tests
  // =========================================================================
  describe('deriveSharedSecret', () => {
    let aliceKeyPair: CryptoKeyPair;
    let bobKeyPair: CryptoKeyPair;

    beforeEach(async () => {
      aliceKeyPair = await generateKeyPair();
      bobKeyPair = await generateKeyPair();
    });

    it('should derive the same shared secret for both parties', async () => {
      // Alice derives secret using her private key and Bob's public key
      const aliceSecret = await deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);

      // Bob derives secret using his private key and Alice's public key
      const bobSecret = await deriveSharedSecret(bobKeyPair.privateKey, aliceKeyPair.publicKey);

      expect(aliceSecret).toEqual(bobSecret);
    });

    it('should derive a 256-bit (32 byte) shared secret', async () => {
      const secret = await deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);

      expect(secret).toBeInstanceOf(Uint8Array);
      expect(secret.length).toBe(32);
    });

    it('should derive different secrets with different key pairs', async () => {
      const eveKeyPair = await generateKeyPair();

      const aliceBobSecret = await deriveSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );

      const aliceEveSecret = await deriveSharedSecret(
        aliceKeyPair.privateKey,
        eveKeyPair.publicKey
      );

      expect(aliceBobSecret).not.toEqual(aliceEveSecret);
    });

    it('should throw on null private key', async () => {
      await expect(
        deriveSharedSecret(null as unknown as CryptoKey, bobKeyPair.publicKey)
      ).rejects.toThrow();
    });

    it('should throw on null public key', async () => {
      await expect(
        deriveSharedSecret(aliceKeyPair.privateKey, null as unknown as CryptoKey)
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // Public Key Export/Import Tests
  // =========================================================================
  describe('exportPublicKey / importPublicKey', () => {
    it('should export public key as raw bytes', async () => {
      const keyPair = await generateKeyPair();

      const exported = await exportPublicKey(keyPair.publicKey);

      expect(exported).toBeInstanceOf(Uint8Array);
      // P-256 uncompressed public key is 65 bytes (1 byte prefix + 32 bytes X + 32 bytes Y)
      expect(exported.length).toBe(65);
    });

    it('should export public key starting with 0x04 (uncompressed point)', async () => {
      const keyPair = await generateKeyPair();

      const exported = await exportPublicKey(keyPair.publicKey);

      expect(exported[0]).toBe(0x04);
    });

    it('should import public key correctly', async () => {
      const originalKeyPair = await generateKeyPair();
      const exported = await exportPublicKey(originalKeyPair.publicKey);

      const imported = await importPublicKey(exported);

      expect(imported.algorithm.name).toBe('ECDH');
      expect((imported.algorithm as EcKeyGenParams).namedCurve).toBe('P-256');
    });

    it('should be able to derive shared secret with imported key', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();

      // Export and import Bob's public key
      const bobPublicKeyBytes = await exportPublicKey(bobKeyPair.publicKey);
      const importedBobPublicKey = await importPublicKey(bobPublicKeyBytes);

      // Derive secret with imported key
      const secretWithImported = await deriveSharedSecret(
        aliceKeyPair.privateKey,
        importedBobPublicKey
      );

      // Derive secret with original key
      const secretWithOriginal = await deriveSharedSecret(
        aliceKeyPair.privateKey,
        bobKeyPair.publicKey
      );

      expect(secretWithImported).toEqual(secretWithOriginal);
    });

    it('should reject invalid public key bytes', async () => {
      const invalidKey = new Uint8Array(32); // Wrong size

      await expect(importPublicKey(invalidKey)).rejects.toThrow();
    });

    it('should reject public key with wrong prefix', async () => {
      const invalidKey = new Uint8Array(65);
      invalidKey[0] = 0x02; // Compressed format prefix, not supported

      await expect(importPublicKey(invalidKey)).rejects.toThrow();
    });
  });

  // =========================================================================
  // Key Fingerprint Tests
  // =========================================================================
  describe('computeFingerprint', () => {
    it('should compute a SHA-256 fingerprint of the public key', async () => {
      const keyPair = await generateKeyPair();

      const fingerprint = await computeFingerprint(keyPair.publicKey);

      expect(fingerprint).toBeInstanceOf(Uint8Array);
      expect(fingerprint.length).toBe(32); // SHA-256 = 32 bytes
    });

    it('should compute the same fingerprint for the same key', async () => {
      const keyPair = await generateKeyPair();

      const fingerprint1 = await computeFingerprint(keyPair.publicKey);
      const fingerprint2 = await computeFingerprint(keyPair.publicKey);

      expect(fingerprint1).toEqual(fingerprint2);
    });

    it('should compute different fingerprints for different keys', async () => {
      const keyPair1 = await generateKeyPair();
      const keyPair2 = await generateKeyPair();

      const fingerprint1 = await computeFingerprint(keyPair1.publicKey);
      const fingerprint2 = await computeFingerprint(keyPair2.publicKey);

      expect(fingerprint1).not.toEqual(fingerprint2);
    });

    it('should work with imported public keys', async () => {
      const keyPair = await generateKeyPair();
      const exported = await exportPublicKey(keyPair.publicKey);
      const imported = await importPublicKey(exported);

      const originalFingerprint = await computeFingerprint(keyPair.publicKey);
      const importedFingerprint = await computeFingerprint(imported);

      expect(originalFingerprint).toEqual(importedFingerprint);
    });
  });

  describe('formatFingerprint', () => {
    it('should format fingerprint as uppercase hex with colons', async () => {
      const keyPair = await generateKeyPair();
      const fingerprint = await computeFingerprint(keyPair.publicKey);

      const formatted = formatFingerprint(fingerprint);

      // Should be like "AB:CD:EF:..."
      expect(formatted).toMatch(/^([A-F0-9]{2}:){31}[A-F0-9]{2}$/);
    });

    it('should format 8-byte fingerprint correctly (truncated)', async () => {
      const fingerprint = new Uint8Array([0x12, 0xab, 0xcd, 0xef, 0x00, 0x11, 0x22, 0x33]);

      const formatted = formatFingerprint(fingerprint, 8);

      expect(formatted).toBe('12:AB:CD:EF:00:11:22:33');
    });

    it('should return consistent format', async () => {
      const keyPair = await generateKeyPair();
      const fingerprint = await computeFingerprint(keyPair.publicKey);

      const formatted1 = formatFingerprint(fingerprint);
      const formatted2 = formatFingerprint(fingerprint);

      expect(formatted1).toBe(formatted2);
    });
  });

  // =========================================================================
  // deriveEncryptionKey Tests
  // =========================================================================
  describe('deriveEncryptionKey', () => {
    it('should derive an AES-GCM-256 key from shared secret', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();

      const sharedSecret = await deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);
      const encryptionKey = await deriveEncryptionKey(sharedSecret);

      expect(encryptionKey).toBeDefined();
      expect(encryptionKey.algorithm.name).toBe('AES-GCM');
      expect((encryptionKey.algorithm as AesKeyGenParams).length).toBe(256);
    });

    it('should derive same key from same shared secret', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();

      const sharedSecret = await deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);

      const key1 = await deriveEncryptionKey(sharedSecret);
      const key2 = await deriveEncryptionKey(sharedSecret);

      // Export both keys to compare
      const exported1 = await crypto.subtle.exportKey('raw', key1);
      const exported2 = await crypto.subtle.exportKey('raw', key2);

      expect(Array.from(new Uint8Array(exported1))).toEqual(Array.from(new Uint8Array(exported2)));
    });

    it('should derive different keys with different info', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();

      const sharedSecret = await deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);

      const info1 = new TextEncoder().encode('sender');
      const info2 = new TextEncoder().encode('receiver');

      const key1 = await deriveEncryptionKey(sharedSecret, info1);
      const key2 = await deriveEncryptionKey(sharedSecret, info2);

      // Export both keys to compare
      const exported1 = await crypto.subtle.exportKey('raw', key1);
      const exported2 = await crypto.subtle.exportKey('raw', key2);

      expect(Array.from(new Uint8Array(exported1))).not.toEqual(
        Array.from(new Uint8Array(exported2))
      );
    });

    it('should derive usable encryption key', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();

      const sharedSecret = await deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);
      const encryptionKey = await deriveEncryptionKey(sharedSecret);

      // Try to encrypt/decrypt with the derived key
      const plaintext = new TextEncoder().encode('Hello, World!');
      const iv = crypto.getRandomValues(new Uint8Array(12));

      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        encryptionKey,
        plaintext
      );

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        encryptionKey,
        encrypted
      );

      // Compare as arrays
      const decryptedArray = Array.from(new Uint8Array(decrypted));
      const plaintextArray = Array.from(plaintext);
      expect(decryptedArray).toEqual(plaintextArray);
    });

    it('should have correct key usages', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();

      const sharedSecret = await deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);
      const encryptionKey = await deriveEncryptionKey(sharedSecret);

      expect(encryptionKey.usages).toContain('encrypt');
      expect(encryptionKey.usages).toContain('decrypt');
    });

    it('should be extractable', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();

      const sharedSecret = await deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);
      const encryptionKey = await deriveEncryptionKey(sharedSecret);

      expect(encryptionKey.extractable).toBe(true);
    });
  });

  // =========================================================================
  // Error Handling Tests
  // =========================================================================
  describe('Error Handling', () => {
    it('should throw E2EEError when importPublicKey fails with valid format but invalid point', async () => {
      // Create a key that has correct format (65 bytes, starts with 0x04)
      // but has invalid point data
      const invalidKey = new Uint8Array(65);
      invalidKey[0] = 0x04; // Correct prefix
      // Fill with zeros - this is an invalid point on the P-256 curve
      // The origin point (0,0) is not on the curve

      await expect(importPublicKey(invalidKey)).rejects.toThrow();
    });
  });

  // =========================================================================
  // Full Key Exchange Flow Tests
  // =========================================================================
  describe('Full Key Exchange Flow', () => {
    it('should complete a full key exchange between two parties', async () => {
      // 1. Alice generates key pair
      const aliceKeyPair = await generateKeyPair();
      const alicePublicKeyBytes = await exportPublicKey(aliceKeyPair.publicKey);

      // 2. Bob generates key pair
      const bobKeyPair = await generateKeyPair();
      const bobPublicKeyBytes = await exportPublicKey(bobKeyPair.publicKey);

      // 3. Alice receives Bob's public key (simulating network transfer)
      const bobPublicKeyImported = await importPublicKey(bobPublicKeyBytes);

      // 4. Bob receives Alice's public key (simulating network transfer)
      const alicePublicKeyImported = await importPublicKey(alicePublicKeyBytes);

      // 5. Both derive shared secret
      const aliceSharedSecret = await deriveSharedSecret(
        aliceKeyPair.privateKey,
        bobPublicKeyImported
      );

      const bobSharedSecret = await deriveSharedSecret(
        bobKeyPair.privateKey,
        alicePublicKeyImported
      );

      // 6. Verify same secret
      expect(aliceSharedSecret).toEqual(bobSharedSecret);

      // 7. Verify fingerprints match
      const aliceFingerprint = await computeFingerprint(aliceKeyPair.publicKey);
      const aliceFingerprintFromBob = await computeFingerprint(alicePublicKeyImported);
      expect(aliceFingerprint).toEqual(aliceFingerprintFromBob);
    });

    it('should protect against man-in-the-middle with fingerprint verification', async () => {
      const aliceKeyPair = await generateKeyPair();
      const bobKeyPair = await generateKeyPair();
      const eveKeyPair = await generateKeyPair(); // Attacker

      // Alice's fingerprint that she tells Bob out-of-band
      const aliceFingerprint = await computeFingerprint(aliceKeyPair.publicKey);

      // Eve tries to impersonate Alice
      const eveFingerprint = await computeFingerprint(eveKeyPair.publicKey);

      // Bob verifies fingerprint doesn't match
      expect(aliceFingerprint).not.toEqual(eveFingerprint);
    });
  });
});
