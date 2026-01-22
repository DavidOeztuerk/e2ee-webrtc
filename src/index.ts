/**
 * @module e2ee-webrtc
 * Framework-agnostic End-to-End Encrypted WebRTC library
 *
 * @description
 * Provides E2EE for WebRTC with support for:
 * - Chrome/Chromium (Insertable Streams API)
 * - Safari (RTCRtpScriptTransform API)
 * - Post-Quantum hybrid encryption (Kyber + ECDH)
 * - Multi-Party SFU support
 * - Self-hosted and managed deployment
 *
 * @example
 * ```typescript
 * import { E2EEClient, isE2EESupported } from '@aspect/e2ee-webrtc';
 *
 * // Check support
 * if (!isE2EESupported()) {
 *   console.warn('E2EE not supported');
 * }
 *
 * // Create client
 * const client = new E2EEClient({
 *   mode: 'self-hosted',
 *   signaling: { url: 'wss://your-server.com' },
 * });
 *
 * // Initialize and start encryption
 * await client.initialize();
 * await client.enableEncryption(peerConnection);
 *
 * // Listen for events
 * client.on('key-exchanged', (event) => {
 *   console.log('Keys exchanged with peer');
 * });
 * ```
 *
 * @packageDocumentation
 */

// Re-export types
export type {
  // Configuration
  E2EEConfig,
  DeploymentMode,
  SecurityConfig,
  SignalingConfig,
  SfuConfig,
  TurnConfig,
  PostQuantumConfig,
  KeyRotationConfig,

  // Crypto
  EncryptionAlgorithm,
  KeyExchangeAlgorithm,
  KeyGeneration,
  EncryptionState,
  EncryptedFrame,
  KeyExchangeMessage,
  KeyExchangeMessageType,

  // Browser
  BrowserCapabilities,
  BrowserType,
  E2EEMethod,

  // Session
  Participant,
  ParticipantRole,
  Session,
  SessionTopology,

  // Events
  E2EEEvent,
  E2EEEventType,
  E2EEErrorEvent,
  E2EEKeyEvent,
  E2EEEventListener,

  // Workers
  WorkerMessage,
  WorkerMessageType,
  WorkerInitMessage,
  WorkerSetKeyMessage,
  WorkerStats,

  // SFU
  SenderKey,
  SfuRoom,
} from './types';

// Re-export error types
export { E2EEError, E2EEErrorCode } from './types';

// Re-export core functionality
export {
  // Crypto
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
  formatKeyFingerprint,
  generateKeyPair,
  deriveSharedSecret,
  exportPublicKey,
  importPublicKey,
  computeFingerprint,
  formatFingerprint,
  deriveEncryptionKey,

  // Key Manager
  KeyManager,
} from './core';

export type { KeyManagerConfig, KeyManagerEventType, KeyManagerEventData } from './core';

// Re-export browser detection
export {
  detectBrowser,
  detectCapabilities,
  getBestE2EEMethod,
  isE2EESupported,
  getWorkerUrl,
  parseVersion,
  meetsMinimumVersion,
  getE2EESupportDescription,
} from './browser';

// Main client class (to be implemented)
// export { E2EEClient } from './client';

// Version
export const VERSION = '0.1.0';
