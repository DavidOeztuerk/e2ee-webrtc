/**
 * @module browser/safari
 * Safari-specific E2EE implementation using RTCRtpScriptTransform
 *
 * @description
 * Uses Safari's RTCRtpScriptTransform API for frame transformation.
 * Available in Safari 15.4+
 *
 * Unlike Chrome, Safari requires a dedicated Worker that receives
 * streams via the 'rtctransform' event.
 */

import type { KeyGeneration } from '../../types';

/**
 * Safari E2EE configuration
 */
export interface SafariE2EEConfig {
  /** Participant ID for logging */
  participantId: string;
  /** URL to the Safari E2EE worker script */
  workerUrl: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Worker message types
 */
interface WorkerMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Safari RTCRtpScriptTransform type (not in standard TypeScript definitions)
 */
declare class RTCRtpScriptTransform {
  constructor(worker: Worker, options?: { mode?: string; participantId?: string });
}

/**
 * Safari E2EE Transform handler
 *
 * Creates RTCRtpScriptTransform instances that delegate to a worker
 * for actual frame encryption/decryption.
 */
export class SafariE2EETransform {
  private readonly config: Required<SafariE2EEConfig>;
  private worker: Worker | null = null;
  private initialized = false;
  private pendingKeyData: ArrayBuffer | null = null;
  private currentGeneration: KeyGeneration = 0 as KeyGeneration;

  constructor(config: SafariE2EEConfig) {
    this.config = {
      participantId: config.participantId,
      workerUrl: config.workerUrl,
      debug: config.debug ?? false,
    };
  }

  /**
   * Initializes the worker
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.worker = new Worker(this.config.workerUrl, { type: 'module' });

    // Set up message handler
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      this.handleWorkerMessage(event.data);
    };

    this.worker.onerror = (error) => {
      this.log('Worker error:', error);
    };

    // Send init message
    this.worker.postMessage({
      type: 'init',
      config: {
        participantId: this.config.participantId,
        debug: this.config.debug,
      },
    });

    // Wait for ready message
    await this.waitForReady();

    // Send any pending key
    if (this.pendingKeyData !== null) {
      this.setKey(this.pendingKeyData, this.currentGeneration);
      this.pendingKeyData = null;
    }

    this.initialized = true;
  }

  /**
   * Sets the encryption key
   */
  setKey(keyData: ArrayBuffer, generation: KeyGeneration): void {
    this.currentGeneration = generation;

    if (this.worker === null || !this.initialized) {
      // Store for later
      this.pendingKeyData = keyData;
      return;
    }

    this.worker.postMessage({
      type: 'set-key',
      keyData,
      generation,
    });
  }

  /**
   * Creates an RTCRtpScriptTransform for encryption (sender)
   */
  createSenderTransform(): RTCRtpScriptTransform {
    if (this.worker === null) {
      throw new Error('Worker not initialized. Call initialize() first.');
    }

    return new RTCRtpScriptTransform(this.worker, {
      mode: 'encrypt',
      participantId: this.config.participantId,
    });
  }

  /**
   * Creates an RTCRtpScriptTransform for decryption (receiver)
   */
  createReceiverTransform(): RTCRtpScriptTransform {
    if (this.worker === null) {
      throw new Error('Worker not initialized. Call initialize() first.');
    }

    return new RTCRtpScriptTransform(this.worker, {
      mode: 'decrypt',
      participantId: this.config.participantId,
    });
  }

  /**
   * Attaches encryption transform to a sender
   */
  attachToSender(sender: RTCRtpSender): void {
    const transform = this.createSenderTransform();
    (sender as RTCRtpSender & { transform: RTCRtpScriptTransform }).transform = transform;
  }

  /**
   * Attaches decryption transform to a receiver
   */
  attachToReceiver(receiver: RTCRtpReceiver): void {
    const transform = this.createReceiverTransform();
    (receiver as RTCRtpReceiver & { transform: RTCRtpScriptTransform }).transform = transform;
  }

  /**
   * Requests stats from the worker
   */
  async getStats(): Promise<{
    framesEncrypted: number;
    framesDecrypted: number;
    encryptionErrors: number;
    decryptionErrors: number;
  }> {
    if (this.worker === null) {
      return {
        framesEncrypted: 0,
        framesDecrypted: 0,
        encryptionErrors: 0,
        decryptionErrors: 0,
      };
    }

    return new Promise((resolve) => {
      const handler = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === 'stats') {
          this.worker?.removeEventListener('message', handler);
          resolve(event.data.stats as {
            framesEncrypted: number;
            framesDecrypted: number;
            encryptionErrors: number;
            decryptionErrors: number;
          });
        }
      };

      this.worker!.addEventListener('message', handler);
      this.worker!.postMessage({ type: 'stats' });
    });
  }

  /**
   * Terminates the worker
   */
  destroy(): void {
    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
      this.initialized = false;
    }
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker initialization timeout'));
      }, 5000);

      const handler = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === 'ready') {
          clearTimeout(timeout);
          this.worker?.removeEventListener('message', handler);
          resolve();
        } else if (event.data.type === 'error') {
          clearTimeout(timeout);
          this.worker?.removeEventListener('message', handler);
          reject(new Error(event.data.message as string));
        }
      };

      this.worker!.addEventListener('message', handler);
    });
  }

  private handleWorkerMessage(message: WorkerMessage): void {
    switch (message.type) {
      case 'error':
        this.log('Worker error:', message.code, message.message);
        break;
      case 'key-ack':
        this.log('Key acknowledged, generation:', message.generation);
        break;
      default:
        // Stats and other messages handled elsewhere
        break;
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      // eslint-disable-next-line no-console
      console.log(`[SafariE2EE ${this.config.participantId}]`, ...args);
    }
  }
}

/**
 * Creates E2EE transforms for Safari
 */
export function createSafariE2EE(config: SafariE2EEConfig): SafariE2EETransform {
  return new SafariE2EETransform(config);
}

/**
 * Checks if Safari RTCRtpScriptTransform is supported
 */
export function isScriptTransformSupported(): boolean {
  return 'RTCRtpScriptTransform' in globalThis;
}

/**
 * Gets the Safari version that added RTCRtpScriptTransform support
 */
export function getMinSupportedSafariVersion(): string {
  return '15.4';
}
