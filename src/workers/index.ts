/**
 * @module workers
 * E2EE transform workers for WebRTC frame encryption
 *
 * @description
 * This module provides Web Workers for real-time encryption and decryption
 * of WebRTC media frames. Two implementations are provided:
 *
 * - **Chrome Worker**: Uses Insertable Streams API (Chrome 86+, Edge 86+)
 * - **Safari Worker**: Uses RTCRtpScriptTransform API (Safari 15.4+)
 *
 * @example
 * ```typescript
 * import { detectCapabilities, getWorkerUrl } from '@aspect/e2ee-webrtc/browser';
 *
 * const caps = detectCapabilities();
 * const workerUrl = getWorkerUrl(caps.e2eeMethod);
 *
 * if (workerUrl) {
 *   const worker = new Worker(workerUrl, { type: 'module' });
 *   worker.postMessage({
 *     type: 'init',
 *     config: { participantId: 'user123', mode: 'encrypt' }
 *   });
 * }
 * ```
 */

// Worker types
export type {
  WorkerMode,
  WorkerConfig,
  WorkerState,
  WorkerMessageType,
  BaseWorkerMessage,
  InitMessage,
  SetKeyMessage,
  TransformMessage,
  StatsMessage,
  ReadyMessage,
  KeyAckMessage,
  ErrorMessage,
  StatsResponseMessage,
  WorkerMessage,
  FrameMetadata,
} from './types';

// Constants
export { HEADER_SIZE, IV_SIZE, AUTH_TAG_SIZE } from './types';

// Crypto utilities (for advanced usage or testing)
export {
  importKey as workerImportKey,
  generateIV as workerGenerateIV,
  encryptFrame as workerEncryptFrame,
  decryptFrame as workerDecryptFrame,
  getFrameGeneration,
  isValidFrameLength,
} from './crypto-utils';

/**
 * Gets the inline worker code for Chrome
 *
 * @returns Blob URL for Chrome worker
 *
 * @description
 * Use this when you want to create the worker from inline code
 * rather than loading from a URL. Useful for bundled applications.
 *
 * @example
 * ```typescript
 * import { createChromeWorkerBlob } from '@aspect/e2ee-webrtc/workers';
 *
 * const worker = new Worker(createChromeWorkerBlob(), { type: 'module' });
 * ```
 */
export function createChromeWorkerBlob(): string {
  // This will be replaced by the build system with the actual worker code
  throw new Error(
    'createChromeWorkerBlob is not available in source form. ' +
      'Use the built workers from dist/workers/ or load chrome-e2ee-worker.js directly.'
  );
}

/**
 * Gets the inline worker code for Safari
 *
 * @returns Blob URL for Safari worker
 *
 * @description
 * Use this when you want to create the worker from inline code
 * rather than loading from a URL. Useful for bundled applications.
 *
 * @example
 * ```typescript
 * import { createSafariWorkerBlob } from '@aspect/e2ee-webrtc/workers';
 *
 * const worker = new Worker(createSafariWorkerBlob(), { type: 'module' });
 * ```
 */
export function createSafariWorkerBlob(): string {
  // This will be replaced by the build system with the actual worker code
  throw new Error(
    'createSafariWorkerBlob is not available in source form. ' +
      'Use the built workers from dist/workers/ or load safari-e2ee-worker.js directly.'
  );
}
