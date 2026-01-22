/**
 * @module workers/crypto-utils
 * Shared cryptographic utilities for E2EE workers
 *
 * @description
 * Self-contained crypto functions for use in Web Workers.
 * Workers cannot import from main thread modules, so we duplicate
 * the minimal crypto logic needed for frame encryption/decryption.
 */

import type { KeyGeneration } from '../types';
import { HEADER_SIZE, IV_SIZE, AUTH_TAG_SIZE } from './types';

/** Key size for AES-256 (32 bytes = 256 bits) */
const KEY_SIZE = 32;

/**
 * Imports raw key bytes as an AES-GCM CryptoKey
 *
 * @param keyData - 32-byte key material
 * @returns Promise resolving to CryptoKey
 * @throws Error if key data is not 32 bytes
 */
export async function importKey(keyData: ArrayBuffer): Promise<CryptoKey> {
  if (keyData.byteLength !== KEY_SIZE) {
    throw new Error(`Invalid key length: expected ${KEY_SIZE} bytes, got ${keyData.byteLength}`);
  }
  return crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Generates a cryptographically secure random IV
 *
 * @returns 12-byte Uint8Array
 */
export function generateIV(): Uint8Array {
  const iv = new Uint8Array(IV_SIZE);
  crypto.getRandomValues(iv);
  return iv;
}

/**
 * Encrypts a frame using AES-GCM-256
 *
 * Output format: [Generation (1 byte)][IV (12 bytes)][Ciphertext + AuthTag]
 *
 * @param plaintext - Frame data to encrypt
 * @param key - AES-GCM encryption key
 * @param generation - Key generation number (0-255)
 * @returns Encrypted frame with header
 */
export async function encryptFrame(
  plaintext: Uint8Array,
  key: CryptoKey,
  generation: KeyGeneration
): Promise<Uint8Array> {
  const iv = generateIV();

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      tagLength: 128,
    },
    key,
    plaintext
  );

  // Combine: generation (1) + iv (12) + ciphertext
  const result = new Uint8Array(1 + IV_SIZE + ciphertext.byteLength);
  result[0] = generation & 0xff;
  result.set(iv, 1);
  result.set(new Uint8Array(ciphertext), 1 + IV_SIZE);

  return result;
}

/**
 * Decrypts a frame using AES-GCM-256
 *
 * Input format: [Generation (1 byte)][IV (12 bytes)][Ciphertext + AuthTag]
 *
 * @param encrypted - Encrypted frame data
 * @param key - AES-GCM decryption key
 * @returns Decrypted plaintext
 * @throws Error if decryption fails
 */
export async function decryptFrame(encrypted: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  if (encrypted.length < HEADER_SIZE + AUTH_TAG_SIZE) {
    throw new Error(`Frame too short: ${encrypted.length} bytes`);
  }

  const iv = encrypted.slice(1, 1 + IV_SIZE);
  const ciphertext = encrypted.slice(1 + IV_SIZE);

  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
      tagLength: 128,
    },
    key,
    ciphertext
  );

  return new Uint8Array(plaintext);
}

/**
 * Extracts the key generation from an encrypted frame
 *
 * @param encrypted - Encrypted frame data
 * @returns Key generation number (0-255)
 */
export function getFrameGeneration(encrypted: Uint8Array): KeyGeneration {
  if (encrypted.length < 1) {
    throw new Error('Frame is empty');
  }
  return encrypted[0] as KeyGeneration;
}

/**
 * Validates that a frame has sufficient length for decryption
 *
 * @param encrypted - Encrypted frame data
 * @returns true if frame is valid length
 */
export function isValidFrameLength(encrypted: Uint8Array): boolean {
  return encrypted.length >= HEADER_SIZE + AUTH_TAG_SIZE;
}
