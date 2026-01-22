/**
 * @module browser/chrome
 * Chrome/Chromium-specific E2EE implementation using Insertable Streams
 *
 * @description
 * Uses the Encoded Transform API (RTCRtpSender/Receiver.transform)
 * Available in Chrome 86+, Edge 86+, Opera 72+
 */

// KeyGeneration type would be used when implementing full key rotation
// import type { KeyGeneration } from '../../types';
import { FrameProcessor, type KeyProvider } from '../../core/frame-processor';

/**
 * Chrome E2EE configuration
 */
export interface ChromeE2EEConfig {
  /** Participant ID for logging */
  participantId: string;
  /** Key provider for encryption/decryption */
  keyProvider: KeyProvider;
  /** Enable debug logging */
  debug?: boolean;
  /** Worker URL for offloading crypto to worker thread */
  workerUrl?: string;
}

/**
 * Encoded frame with metadata (Chrome's RTCEncodedVideoFrame/RTCEncodedAudioFrame)
 */
interface EncodedFrame {
  data: ArrayBuffer;
  timestamp: number;
  type?: 'key' | 'delta';
  getMetadata(): {
    synchronizationSource?: number;
    contributingSources?: number[];
    payloadType?: number;
  };
}

/**
 * Chrome E2EE Transform handler
 *
 * Attaches to RTCRtpSender/Receiver.transform to encrypt/decrypt frames
 */
export class ChromeE2EETransform {
  private readonly config: Required<Omit<ChromeE2EEConfig, 'workerUrl'>> & { workerUrl?: string };
  private readonly processor: FrameProcessor;
  private encryptTransform: TransformStream | null = null;
  private decryptTransform: TransformStream | null = null;

  constructor(config: ChromeE2EEConfig) {
    this.config = {
      participantId: config.participantId,
      keyProvider: config.keyProvider,
      debug: config.debug ?? false,
      workerUrl: config.workerUrl,
    };

    this.processor = new FrameProcessor({
      participantId: config.participantId,
      debug: config.debug,
    });
    this.processor.setKeyProvider(config.keyProvider);
  }

  /**
   * Creates an encryption transform for an RTCRtpSender
   *
   * @param sender - The RTCRtpSender to attach to
   */
  attachToSender(sender: RTCRtpSender): void {
    // Check if Encoded Transform is supported
    if (!('transform' in sender)) {
      throw new Error('Encoded Transform API not supported');
    }

    this.encryptTransform = new TransformStream({
      transform: async (frame: EncodedFrame, controller) => {
        try {
          const plaintext = new Uint8Array(frame.data);
          const encrypted = await this.processor.encryptFrame(plaintext);

          frame.data = encrypted.buffer;
          controller.enqueue(frame);
        } catch (error) {
          this.log('Encryption error:', error);
          // Pass through on error
          controller.enqueue(frame);
        }
      },
    });

    // Type assertion needed because TypeScript doesn't know about RTCRtpScriptTransform
    (sender as RTCRtpSender & { transform: TransformStream }).transform = this.encryptTransform;
  }

  /**
   * Creates a decryption transform for an RTCRtpReceiver
   *
   * @param receiver - The RTCRtpReceiver to attach to
   */
  attachToReceiver(receiver: RTCRtpReceiver): void {
    if (!('transform' in receiver)) {
      throw new Error('Encoded Transform API not supported');
    }

    this.decryptTransform = new TransformStream({
      transform: async (frame: EncodedFrame, controller) => {
        try {
          const encrypted = new Uint8Array(frame.data);
          const decrypted = await this.processor.decryptFrame(encrypted);

          if (decrypted !== null) {
            frame.data = decrypted.buffer;
            controller.enqueue(frame);
          }
          // If decrypted is null, frame is dropped
        } catch (error) {
          this.log('Decryption error:', error);
          // Drop frame on error
        }
      },
    });

    (receiver as RTCRtpReceiver & { transform: TransformStream }).transform = this.decryptTransform;
  }

  /**
   * Detaches transforms from sender/receiver
   */
  detach(senderOrReceiver: RTCRtpSender | RTCRtpReceiver): void {
    if ('transform' in senderOrReceiver) {
      (senderOrReceiver as { transform: TransformStream | null }).transform = null;
    }
  }

  /**
   * Gets processing statistics
   */
  getStats() {
    return this.processor.getStats();
  }

  /**
   * Updates the key provider
   */
  setKeyProvider(provider: KeyProvider): void {
    this.processor.setKeyProvider(provider);
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      // eslint-disable-next-line no-console
      console.log(`[ChromeE2EE ${this.config.participantId}]`, ...args);
    }
  }
}

/**
 * Creates E2EE transforms for a Chrome RTCPeerConnection
 */
export function createChromeE2EE(config: ChromeE2EEConfig): ChromeE2EETransform {
  return new ChromeE2EETransform(config);
}

/**
 * Checks if Chrome Insertable Streams is supported
 */
export function isInsertableStreamsSupported(): boolean {
  if (typeof RTCRtpSender === 'undefined') return false;

  // Check for transform property on sender prototype
  const sender = Object.getOwnPropertyDescriptor(RTCRtpSender.prototype, 'transform');
  return sender !== undefined;
}

/**
 * Gets the Chrome Insertable Streams API version
 */
export function getInsertableStreamsVersion(): 'none' | 'encoded-transform' | 'insertable-streams' {
  if (!isInsertableStreamsSupported()) return 'none';

  // Encoded Transform is the newer API (Chrome 86+)
  // Insertable Streams was the older experimental API
  if ('RTCRtpScriptTransform' in globalThis) {
    return 'encoded-transform';
  }

  return 'insertable-streams';
}
