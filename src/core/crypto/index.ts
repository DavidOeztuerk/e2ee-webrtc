/**
 * @module core/crypto
 * Cryptographic primitives for E2EE WebRTC
 *
 * @description
 * This module exports all cryptographic functions needed for E2EE:
 * - AES-GCM-256 for frame encryption
 * - ECDH P-256 for key exchange
 * - Key management utilities
 */

// AES-GCM encryption
export {
  generateEncryptionKey,
  encryptFrame,
  decryptFrame,
  generateIV,
  exportKey,
  importKey,
  constantTimeCompare,
  zeroizeKey,
  serializeFrame,
  deserializeFrame,
  computeKeyFingerprint,
  formatFingerprint as formatKeyFingerprint,
} from './aes-gcm';

// ECDH key exchange
export {
  generateKeyPair,
  deriveSharedSecret,
  exportPublicKey,
  importPublicKey,
  computeFingerprint,
  formatFingerprint,
  deriveEncryptionKey,
} from './ecdh';
