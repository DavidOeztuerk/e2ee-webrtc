/**
 * @module workers/safari-e2ee-worker
 * E2EE transform worker for Safari using RTCRtpScriptTransform API
 *
 * @description
 * This worker handles real-time encryption/decryption of WebRTC media frames
 * using Safari's RTCRtpScriptTransform API.
 *
 * Unlike Chrome's Insertable Streams, Safari workers receive transform streams
 * via the 'rtctransform' event rather than postMessage.
 *
 * Usage:
 * 1. Create worker: `new Worker('safari-e2ee-worker.js', { type: 'module' })`
 * 2. Send 'init' message with config
 * 3. Send 'set-key' message with encryption key
 * 4. Create RTCRtpScriptTransform and assign to sender/receiver.transform
 *
 * Frame format (encrypted):
 * [Generation (1 byte)][IV (12 bytes)][Ciphertext + AuthTag (16 bytes)]
 */

import type { KeyGeneration } from '../types';
import type {
  WorkerState,
  WorkerConfig,
  InitMessage,
  SetKeyMessage,
  StatsMessage,
  ErrorMessage,
  ReadyMessage,
  KeyAckMessage,
  StatsResponseMessage,
} from './types';
import {
  encryptFrame,
  decryptFrame,
  getFrameGeneration,
  importKey,
  isValidFrameLength,
} from './crypto-utils';

/** Transform options for Safari's RTCRtpScriptTransform */
interface SafariTransformOptions {
  mode?: 'encrypt' | 'decrypt';
  participantId?: string;
}

/** Safari RTCTransformEvent with our options type */
interface SafariRTCTransformEvent extends Event {
  transformer: {
    readable: ReadableStream;
    writable: WritableStream;
    options?: SafariTransformOptions;
  };
}

/** Control message with type field */
interface ControlMessage {
  type: string;
}

// Worker state
const state: WorkerState = {
  initialized: false,
  currentKey: null,
  currentGeneration: 0,
  previousKey: null,
  previousGeneration: 0,
  keyHistory: new Map(),
  maxKeyHistory: 5,
  stats: {
    framesEncrypted: 0,
    framesDecrypted: 0,
    encryptionErrors: 0,
    decryptionErrors: 0,
    avgEncryptionTimeMs: 0,
    avgDecryptionTimeMs: 0,
    currentGeneration: 0,
  },
};

// Worker configuration
let config: WorkerConfig | null = null;
let debug = false;

/**
 * Logs a debug message if debug mode is enabled
 */
function log(...args: unknown[]): void {
  if (debug) {
    // eslint-disable-next-line no-console
    console.log(`[E2EE Worker ${config?.participantId ?? 'unknown'}]`, ...args);
  }
}

/**
 * Sends an error message to the main thread
 */
function sendError(code: string, message: string, recoverable: boolean, details?: unknown): void {
  const errorMsg: ErrorMessage = {
    type: 'error',
    code,
    message,
    recoverable,
    details,
  };
  self.postMessage(errorMsg);
}

/**
 * Updates a running average
 */
function updateAverage(currentAvg: number, newValue: number, count: number): number {
  return currentAvg + (newValue - currentAvg) / count;
}

/**
 * Gets the key for a specific generation
 */
function getKeyForGeneration(generation: KeyGeneration): CryptoKey | null {
  if (state.currentKey !== null && state.currentGeneration === generation) {
    return state.currentKey;
  }
  if (state.previousKey !== null && state.previousGeneration === generation) {
    return state.previousKey;
  }
  return state.keyHistory.get(generation) ?? null;
}

/**
 * Adds a key to the history, maintaining max size
 */
function addToKeyHistory(generation: KeyGeneration, key: CryptoKey): void {
  state.keyHistory.set(generation, key);

  // Prune old keys if over limit
  if (state.keyHistory.size > state.maxKeyHistory) {
    const oldestGeneration = Math.min(...state.keyHistory.keys());
    state.keyHistory.delete(oldestGeneration);
  }
}

/**
 * Encrypts a single frame
 */
async function encryptFrameHandler(
  frame: RTCEncodedVideoFrame | RTCEncodedAudioFrame,
  controller: TransformStreamDefaultController
): Promise<void> {
  if (state.currentKey === null) {
    // Pass through unencrypted if no key set
    controller.enqueue(frame);
    return;
  }

  const startTime = performance.now();

  try {
    const plaintext = new Uint8Array(frame.data);
    const encrypted = await encryptFrame(plaintext, state.currentKey, state.currentGeneration);

    // Replace frame data with encrypted data
    frame.data = encrypted.buffer;

    state.stats.framesEncrypted++;
    state.stats.avgEncryptionTimeMs = updateAverage(
      state.stats.avgEncryptionTimeMs,
      performance.now() - startTime,
      state.stats.framesEncrypted
    );

    controller.enqueue(frame);
  } catch (error) {
    state.stats.encryptionErrors++;
    log('Encryption error:', error);

    // Pass through on error to maintain call continuity
    controller.enqueue(frame);
    sendError('ENCRYPTION_FAILED', String(error), true);
  }
}

/**
 * Decrypts a single frame
 */
async function decryptFrameHandler(
  frame: RTCEncodedVideoFrame | RTCEncodedAudioFrame,
  controller: TransformStreamDefaultController
): Promise<void> {
  const frameData = new Uint8Array(frame.data);

  // Check if frame is encrypted (has valid header)
  if (!isValidFrameLength(frameData)) {
    // Likely unencrypted frame, pass through
    controller.enqueue(frame);
    return;
  }

  const generation = getFrameGeneration(frameData);
  const key = getKeyForGeneration(generation);

  if (key === null) {
    // No key for this generation - might be an old frame or key not yet received
    state.stats.decryptionErrors++;
    log(`No key for generation ${generation}`);
    // Drop frame rather than pass through corrupted data
    return;
  }

  const startTime = performance.now();

  try {
    const decrypted = await decryptFrame(frameData, key);

    // Replace frame data with decrypted data
    frame.data = decrypted.buffer;

    state.stats.framesDecrypted++;
    state.stats.avgDecryptionTimeMs = updateAverage(
      state.stats.avgDecryptionTimeMs,
      performance.now() - startTime,
      state.stats.framesDecrypted
    );

    controller.enqueue(frame);
  } catch (error) {
    state.stats.decryptionErrors++;
    log('Decryption error:', error);
    // Drop corrupted frames
    sendError('DECRYPTION_FAILED', String(error), true);
  }
}

/**
 * Handles the rtctransform event (Safari's way of providing streams)
 */
async function handleRtcTransform(event: SafariRTCTransformEvent): Promise<void> {
  const transformer = event.transformer;
  const readable = transformer.readable as ReadableStream<
    RTCEncodedVideoFrame | RTCEncodedAudioFrame
  >;
  const writable = transformer.writable as WritableStream<
    RTCEncodedVideoFrame | RTCEncodedAudioFrame
  >;

  const options = transformer.options;

  // Determine mode from options or config
  const mode = options?.mode ?? config?.mode ?? 'decrypt';

  log(`RTCTransform event received, mode: ${mode}`);

  const transform = new TransformStream({
    transform: async (
      frame: RTCEncodedVideoFrame | RTCEncodedAudioFrame,
      controller: TransformStreamDefaultController
    ): Promise<void> => {
      if (mode === 'encrypt') {
        await encryptFrameHandler(frame, controller);
      } else {
        await decryptFrameHandler(frame, controller);
      }
    },
  });

  try {
    await readable.pipeThrough(transform).pipeTo(writable);
  } catch (error) {
    // Pipeline closed (normal when call ends)
    log('Transform pipeline closed:', error);
  }
}

/**
 * Handles the init message
 */
function handleInit(message: InitMessage): void {
  config = message.config;
  debug = message.config.debug === true;

  state.initialized = true;
  state.stats.currentGeneration = state.currentGeneration;

  log('Worker initialized', config);

  const readyMsg: ReadyMessage = {
    type: 'ready',
    config: message.config,
  };
  self.postMessage(readyMsg);
}

/**
 * Handles the set-key message
 */
async function handleSetKey(message: SetKeyMessage): Promise<void> {
  try {
    const key = await importKey(message.keyData);

    if (message.setPrevious === true) {
      // Store as previous key for decryption overlap
      state.previousKey = key;
      state.previousGeneration = message.generation;
    } else {
      // Rotate: current becomes previous
      if (state.currentKey !== null) {
        state.previousKey = state.currentKey;
        state.previousGeneration = state.currentGeneration;
        addToKeyHistory(state.currentGeneration, state.currentKey);
      }

      state.currentKey = key;
      state.currentGeneration = message.generation;
      state.stats.currentGeneration = message.generation;
    }

    log(
      `Key set for generation ${message.generation}`,
      message.setPrevious === true ? '(previous)' : '(current)'
    );

    const ackMsg: KeyAckMessage = {
      type: 'key-ack',
      generation: message.generation,
    };
    self.postMessage(ackMsg);
  } catch (error) {
    sendError('KEY_IMPORT_FAILED', String(error), false);
  }
}

/**
 * Handles the stats request message
 */
function handleStats(_message: StatsMessage): void {
  const statsMsg: StatsResponseMessage = {
    type: 'stats',
    stats: { ...state.stats },
  };
  self.postMessage(statsMsg);
}

/**
 * Type guard for control messages
 */
function isControlMessage(data: unknown): data is ControlMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    typeof (data as ControlMessage).type === 'string'
  );
}

/**
 * Main message handler
 */
self.onmessage = async (event: MessageEvent): Promise<void> => {
  const data: unknown = event.data;

  if (isControlMessage(data)) {
    switch (data.type) {
      case 'init':
        handleInit(data as InitMessage);
        break;
      case 'set-key':
        await handleSetKey(data as SetKeyMessage);
        break;
      case 'stats':
        handleStats(data as StatsMessage);
        break;
      default:
        log('Unknown message type:', data.type);
    }
  }
};

// Safari's RTCRtpScriptTransform provides streams via rtctransform event
// Declare Safari-specific worker property
declare const self: DedicatedWorkerGlobalScope & {
  onrtctransform: ((event: SafariRTCTransformEvent) => void) | null;
};
self.onrtctransform = (event: SafariRTCTransformEvent): void => {
  void handleRtcTransform(event);
};

// Export for testing
export {
  state,
  handleInit,
  handleSetKey,
  handleStats,
  handleRtcTransform,
  getKeyForGeneration,
  encryptFrameHandler,
  decryptFrameHandler,
  isControlMessage,
};
