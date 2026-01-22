/**
 * @module core/crypto/ecdh
 * ECDH key exchange for E2EE WebRTC
 *
 * @description
 * Provides ECDH P-256 key exchange with:
 * - Ephemeral key pair generation
 * - Shared secret derivation
 * - Key fingerprinting for verification
 */

import { E2EEError, E2EEErrorCode } from '../../types';

/** P-256 uncompressed public key size (1 + 32 + 32 bytes) */
const PUBLIC_KEY_SIZE = 65;

/** Uncompressed point format prefix */
const UNCOMPRESSED_PREFIX = 0x04;

/** Shared secret size (256 bits) */
const SHARED_SECRET_SIZE = 256;

/**
 * Generates an ECDH P-256 key pair
 *
 * @returns Promise resolving to a CryptoKeyPair
 * @throws {E2EEError} If key generation fails
 *
 * @description
 * Generates an ephemeral ECDH key pair using the P-256 curve (secp256r1).
 * The public key is extractable for sharing, but the private key is not
 * extractable to protect against key leakage.
 *
 * @example
 * ```typescript
 * const keyPair = await generateKeyPair();
 * const publicKeyBytes = await exportPublicKey(keyPair.publicKey);
 * // Send publicKeyBytes to peer
 * ```
 */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  try {
    return await crypto.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      false, // Private key not extractable for security
      ['deriveBits']
    );
  } catch (error) {
    throw new E2EEError(
      E2EEErrorCode.KEY_GENERATION_FAILED,
      'Failed to generate ECDH key pair',
      false,
      error
    );
  }
}

/**
 * Derives a shared secret using ECDH
 *
 * @param privateKey - Local private key
 * @param publicKey - Remote public key
 * @returns Promise resolving to 32-byte shared secret
 * @throws {E2EEError} If derivation fails
 *
 * @description
 * Performs ECDH key agreement to derive a 256-bit shared secret.
 * Both parties will derive the same secret if they use each other's
 * public keys correctly.
 *
 * @example
 * ```typescript
 * // Alice's side
 * const sharedSecret = await deriveSharedSecret(
 *   aliceKeyPair.privateKey,
 *   bobPublicKey
 * );
 * // Bob will derive the same secret using his private key and Alice's public key
 * ```
 */
export async function deriveSharedSecret(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<Uint8Array> {
  if (privateKey === null || privateKey === undefined) {
    throw new E2EEError(E2EEErrorCode.INVALID_KEY, 'Private key is null or undefined', false);
  }

  if (publicKey === null || publicKey === undefined) {
    throw new E2EEError(E2EEErrorCode.INVALID_KEY, 'Public key is null or undefined', false);
  }

  try {
    const sharedBits = await crypto.subtle.deriveBits(
      {
        name: 'ECDH',
        public: publicKey,
      },
      privateKey,
      SHARED_SECRET_SIZE
    );

    return new Uint8Array(sharedBits);
  } catch (error) {
    throw new E2EEError(
      E2EEErrorCode.KEY_EXCHANGE_FAILED,
      'Failed to derive shared secret',
      false,
      error
    );
  }
}

/**
 * Exports a public key as raw bytes
 *
 * @param publicKey - The public key to export
 * @returns Promise resolving to 65-byte Uint8Array (uncompressed point)
 * @throws {E2EEError} If export fails
 *
 * @description
 * Exports the public key in uncompressed point format:
 * [0x04][X coordinate (32 bytes)][Y coordinate (32 bytes)]
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<Uint8Array> {
  try {
    const exported = await crypto.subtle.exportKey('raw', publicKey);
    return new Uint8Array(exported);
  } catch (error) {
    throw new E2EEError(
      E2EEErrorCode.KEY_EXCHANGE_FAILED,
      'Failed to export public key',
      false,
      error
    );
  }
}

/**
 * Imports raw bytes as a public key
 *
 * @param keyData - 65-byte public key in uncompressed format
 * @returns Promise resolving to a CryptoKey
 * @throws {E2EEError} If import fails or key data is invalid
 *
 * @description
 * Imports a public key from uncompressed point format.
 * Validates that the key starts with 0x04 and is 65 bytes.
 */
export async function importPublicKey(keyData: Uint8Array): Promise<CryptoKey> {
  if (keyData.length !== PUBLIC_KEY_SIZE) {
    throw new E2EEError(
      E2EEErrorCode.INVALID_KEY,
      `Invalid public key length: expected ${PUBLIC_KEY_SIZE} bytes, got ${keyData.length}`,
      false
    );
  }

  if (keyData[0] !== UNCOMPRESSED_PREFIX) {
    throw new E2EEError(
      E2EEErrorCode.INVALID_KEY,
      `Invalid public key format: expected uncompressed (0x04), got 0x${keyData[0]?.toString(16)}`,
      false
    );
  }

  try {
    return await crypto.subtle.importKey(
      'raw',
      keyData,
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true, // Extractable for re-export if needed
      [] // Public keys don't have usages
    );
  } catch (error) {
    throw new E2EEError(E2EEErrorCode.INVALID_KEY, 'Failed to import public key', false, error);
  }
}

/**
 * Computes a SHA-256 fingerprint of a public key
 *
 * @param publicKey - The public key to fingerprint
 * @returns Promise resolving to 32-byte fingerprint
 *
 * @description
 * Computes a fingerprint that can be used to verify key authenticity
 * out-of-band (e.g., displayed to users for manual verification).
 *
 * @example
 * ```typescript
 * const fingerprint = await computeFingerprint(keyPair.publicKey);
 * const formatted = formatFingerprint(fingerprint);
 * console.log('Verify this fingerprint:', formatted);
 * // "AB:CD:EF:12:34:..."
 * ```
 */
export async function computeFingerprint(publicKey: CryptoKey): Promise<Uint8Array> {
  const publicKeyBytes = await exportPublicKey(publicKey);
  const hash = await crypto.subtle.digest('SHA-256', publicKeyBytes);
  return new Uint8Array(hash);
}

/**
 * Formats a fingerprint as a human-readable hex string
 *
 * @param fingerprint - The fingerprint bytes
 * @param length - Number of bytes to include (default: all 32)
 * @returns Formatted string like "AB:CD:EF:12:34:..."
 *
 * @example
 * ```typescript
 * const formatted = formatFingerprint(fingerprint);
 * // "AB:CD:EF:12:34:56:78:9A:BC:DE:F0:..."
 *
 * const short = formatFingerprint(fingerprint, 8);
 * // "AB:CD:EF:12:34:56:78:9A"
 * ```
 */
export function formatFingerprint(fingerprint: Uint8Array, length?: number): string {
  const bytes = length !== undefined ? fingerprint.slice(0, length) : fingerprint;
  return Array.from(bytes)
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(':');
}

/**
 * Derives an AES-GCM key from a shared secret using HKDF
 *
 * @param sharedSecret - The ECDH shared secret
 * @param info - Context info for key derivation
 * @returns Promise resolving to an AES-GCM CryptoKey
 *
 * @description
 * Uses HKDF-SHA256 to derive a key suitable for AES-GCM encryption
 * from the raw ECDH shared secret.
 */
export async function deriveEncryptionKey(
  sharedSecret: Uint8Array,
  info: Uint8Array = new Uint8Array(0)
): Promise<CryptoKey> {
  try {
    // Import shared secret as HKDF key material
    const keyMaterial = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, [
      'deriveKey',
    ]);

    // Derive AES-GCM key using HKDF
    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(32), // Zero salt (shared secret has enough entropy)
        info,
      },
      keyMaterial,
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt']
    );
  } catch (error) {
    throw new E2EEError(
      E2EEErrorCode.KEY_GENERATION_FAILED,
      'Failed to derive encryption key from shared secret',
      false,
      error
    );
  }
}
