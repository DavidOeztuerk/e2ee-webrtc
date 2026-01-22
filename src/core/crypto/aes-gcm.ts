/**
 * @module core/crypto/aes-gcm
 * AES-GCM encryption/decryption for E2EE WebRTC frames
 *
 * @description
 * Provides AES-GCM-256 encryption with:
 * - 12-byte random IV (nonce) for each frame
 * - 16-byte authentication tag
 * - Constant-time comparison for security
 * - Key zeroization for security
 */

import type { EncryptedFrame, KeyGeneration } from '../../types';
import { E2EEError, E2EEErrorCode } from '../../types';

/** IV size for AES-GCM (12 bytes = 96 bits, recommended by NIST) */
const IV_SIZE = 12;

/** Authentication tag size (16 bytes = 128 bits) */
const AUTH_TAG_SIZE = 16;

/** Key size for AES-256 (32 bytes = 256 bits) */
const KEY_SIZE = 32;

/** Minimum frame size: generation (1) + IV (12) + auth tag (16) */
const MIN_FRAME_SIZE = 1 + IV_SIZE + AUTH_TAG_SIZE;

/**
 * Generates a new AES-GCM-256 encryption key
 *
 * @returns Promise resolving to a CryptoKey for AES-GCM encryption
 * @throws {E2EEError} If key generation fails
 *
 * @example
 * ```typescript
 * const key = await generateEncryptionKey();
 * // Use key for encryption/decryption
 * ```
 */
export async function generateEncryptionKey(): Promise<CryptoKey> {
  try {
    return await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true, // extractable for export
      ['encrypt', 'decrypt']
    );
  } catch (error) {
    throw new E2EEError(
      E2EEErrorCode.KEY_GENERATION_FAILED,
      'Failed to generate AES-GCM encryption key',
      false,
      error
    );
  }
}

/**
 * Generates a cryptographically secure random IV for AES-GCM
 *
 * @returns 12-byte Uint8Array IV
 *
 * @description
 * AES-GCM requires a unique IV for each encryption operation with the same key.
 * Using 12 bytes (96 bits) as recommended by NIST SP 800-38D.
 * With random IVs, the birthday bound gives us ~2^48 encryptions before
 * IV reuse becomes likely.
 */
export function generateIV(): Uint8Array {
  const iv = new Uint8Array(IV_SIZE);
  crypto.getRandomValues(iv);
  return iv;
}

/**
 * Encrypts a frame using AES-GCM-256
 *
 * @param plaintext - The frame data to encrypt
 * @param key - The AES-GCM encryption key
 * @param generation - Key generation number (0-255)
 * @returns Promise resolving to the encrypted frame
 * @throws {E2EEError} If encryption fails
 *
 * @example
 * ```typescript
 * const encrypted = await encryptFrame(frameData, key, 1);
 * // encrypted.generation = 1
 * // encrypted.iv = 12 random bytes
 * // encrypted.ciphertext = encrypted data + 16 byte auth tag
 * ```
 */
export async function encryptFrame(
  plaintext: Uint8Array,
  key: CryptoKey,
  generation: KeyGeneration
): Promise<EncryptedFrame> {
  if (!key) {
    throw new E2EEError(E2EEErrorCode.INVALID_KEY, 'Encryption key is null or undefined', false);
  }

  try {
    const iv = generateIV();

    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: 128, // 16 bytes
      },
      key,
      plaintext
    );

    return {
      generation: generation & 0xff, // Ensure single byte
      iv,
      ciphertext: new Uint8Array(ciphertext),
    };
  } catch (error) {
    throw new E2EEError(E2EEErrorCode.ENCRYPTION_FAILED, 'Failed to encrypt frame', true, error);
  }
}

/**
 * Decrypts a frame using AES-GCM-256
 *
 * @param frame - The encrypted frame to decrypt
 * @param key - The AES-GCM decryption key
 * @returns Promise resolving to the decrypted plaintext
 * @throws {E2EEError} If decryption fails (wrong key, tampered data, etc.)
 *
 * @example
 * ```typescript
 * const decrypted = await decryptFrame(encryptedFrame, key);
 * // decrypted contains original frame data
 * ```
 */
export async function decryptFrame(frame: EncryptedFrame, key: CryptoKey): Promise<Uint8Array> {
  if (!key) {
    throw new E2EEError(E2EEErrorCode.INVALID_KEY, 'Decryption key is null or undefined', false);
  }

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: frame.iv,
        tagLength: 128,
      },
      key,
      frame.ciphertext
    );

    return new Uint8Array(plaintext);
  } catch (error) {
    throw new E2EEError(
      E2EEErrorCode.DECRYPTION_FAILED,
      'Failed to decrypt frame - data may be corrupted or key mismatch',
      true,
      error
    );
  }
}

/**
 * Exports a CryptoKey as raw bytes
 *
 * @param key - The key to export
 * @returns Promise resolving to 32-byte Uint8Array
 * @throws {E2EEError} If export fails
 */
export async function exportKey(key: CryptoKey): Promise<Uint8Array> {
  try {
    const exported = await crypto.subtle.exportKey('raw', key);
    return new Uint8Array(exported);
  } catch (error) {
    throw new E2EEError(E2EEErrorCode.KEY_GENERATION_FAILED, 'Failed to export key', false, error);
  }
}

/**
 * Imports raw bytes as a CryptoKey
 *
 * @param keyData - 32-byte key material
 * @returns Promise resolving to a CryptoKey
 * @throws {E2EEError} If import fails or key data is invalid
 */
export async function importKey(keyData: Uint8Array): Promise<CryptoKey> {
  if (keyData.length !== KEY_SIZE) {
    throw new E2EEError(
      E2EEErrorCode.INVALID_KEY,
      `Invalid key length: expected ${KEY_SIZE} bytes, got ${keyData.length}`,
      false
    );
  }

  try {
    return await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
  } catch (error) {
    throw new E2EEError(E2EEErrorCode.INVALID_KEY, 'Failed to import key', false, error);
  }
}

/**
 * Constant-time comparison of two byte arrays
 *
 * @description
 * Prevents timing attacks by always comparing all bytes regardless
 * of where differences occur. This is critical for security-sensitive
 * comparisons like MAC verification.
 *
 * @param a - First byte array
 * @param b - Second byte array
 * @returns true if arrays are equal, false otherwise
 */
export function constantTimeCompare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    // XOR will be 0 only if bytes are equal
    // OR accumulates any differences
    result |= a[i]! ^ b[i]!;
  }

  return result === 0;
}

/**
 * Securely zeroizes key material
 *
 * @description
 * Overwrites key material with zeros to prevent key extraction from memory.
 * Note: JavaScript's GC may still keep copies, but this is best effort.
 *
 * @param keyMaterial - The key material to zeroize
 */
export function zeroizeKey(keyMaterial: Uint8Array): void {
  keyMaterial.fill(0);

  // Try to use secure memory clear if available
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    // Overwrite with random data first, then zeros
    // This helps against cold boot attacks
    crypto.getRandomValues(keyMaterial);
    keyMaterial.fill(0);
  }
}

/**
 * Serializes an encrypted frame to a single byte array
 *
 * Format: [Generation (1 byte)][IV (12 bytes)][Ciphertext + AuthTag]
 *
 * @param frame - The encrypted frame to serialize
 * @returns Serialized byte array
 */
export function serializeFrame(frame: EncryptedFrame): Uint8Array {
  const result = new Uint8Array(1 + frame.iv.length + frame.ciphertext.length);
  result[0] = frame.generation;
  result.set(frame.iv, 1);
  result.set(frame.ciphertext, 1 + frame.iv.length);
  return result;
}

/**
 * Deserializes a byte array to an encrypted frame
 *
 * @param data - The serialized frame data
 * @returns The deserialized encrypted frame
 * @throws {E2EEError} If the frame is too short or malformed
 */
export function deserializeFrame(data: Uint8Array): EncryptedFrame {
  if (data.length < MIN_FRAME_SIZE) {
    throw new E2EEError(
      E2EEErrorCode.INVALID_FRAME,
      `Frame too short: expected at least ${MIN_FRAME_SIZE} bytes, got ${data.length}`,
      false
    );
  }

  return {
    generation: data[0] as KeyGeneration,
    iv: data.slice(1, 1 + IV_SIZE),
    ciphertext: data.slice(1 + IV_SIZE),
  };
}

/**
 * Computes a fingerprint (SHA-256 hash) of key material
 *
 * @param keyMaterial - The key bytes to fingerprint
 * @returns Promise resolving to 32-byte fingerprint
 */
export async function computeKeyFingerprint(keyMaterial: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', keyMaterial);
  return new Uint8Array(hash);
}

/**
 * Formats a fingerprint as a human-readable hex string
 *
 * @param fingerprint - The fingerprint bytes
 * @param length - Number of bytes to include (default: all)
 * @returns Formatted string like "AB:CD:EF:..."
 */
export function formatFingerprint(fingerprint: Uint8Array, length?: number): string {
  const bytes = length ? fingerprint.slice(0, length) : fingerprint;
  return Array.from(bytes)
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(':');
}
