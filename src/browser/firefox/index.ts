/**
 * @module browser/firefox
 * Firefox-specific E2EE implementation
 *
 * @description
 * Firefox support for WebRTC E2EE. Firefox has partial support for
 * Insertable Streams (RTCRtpSender/Receiver.transform) starting from
 * Firefox 117+, but with some limitations.
 *
 * This module provides a unified API that adapts to Firefox's capabilities.
 */

import type { KeyGeneration } from '../../types';
import { FrameProcessor, type KeyProvider } from '../../core/frame-processor';

/**
 * Firefox E2EE configuration
 */
export interface FirefoxE2EEConfig {
  /** Participant ID for logging */
  participantId: string;
  /** Key provider for encryption/decryption */
  keyProvider: KeyProvider;
  /** Enable debug logging */
  debug?: boolean;
  /** Use experimental features if available */
  useExperimental?: boolean;
}

/**
 * Firefox capability detection result
 */
export interface FirefoxCapabilities {
  /** Insertable Streams support */
  insertableStreams: boolean;
  /** RTCRtpScriptTransform support */
  scriptTransform: boolean;
  /** Encoded transform support */
  encodedTransform: boolean;
  /** Firefox version */
  version: number | null;
  /** Whether E2EE is fully supported */
  e2eeSupported: boolean;
}

/**
 * Encoded frame interface for Firefox
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
 * Firefox E2EE Transform handler
 *
 * Provides E2EE support for Firefox browsers with capability detection
 * and graceful fallback.
 */
export class FirefoxE2EETransform {
  private readonly config: Required<FirefoxE2EEConfig>;
  private readonly processor: FrameProcessor;
  private readonly capabilities: FirefoxCapabilities;
  private encryptTransform: TransformStream | null = null;
  private decryptTransform: TransformStream | null = null;

  constructor(config: FirefoxE2EEConfig) {
    this.config = {
      participantId: config.participantId,
      keyProvider: config.keyProvider,
      debug: config.debug ?? false,
      useExperimental: config.useExperimental ?? false,
    };

    this.capabilities = detectFirefoxCapabilities();

    this.processor = new FrameProcessor({
      participantId: config.participantId,
      debug: config.debug,
    });
    this.processor.setKeyProvider(config.keyProvider);

    if (!this.capabilities.e2eeSupported) {
      this.log('Warning: E2EE not fully supported in this Firefox version');
    }
  }

  /**
   * Gets detected Firefox capabilities
   */
  getCapabilities(): FirefoxCapabilities {
    return { ...this.capabilities };
  }

  /**
   * Checks if E2EE is supported in this Firefox version
   */
  isSupported(): boolean {
    return this.capabilities.e2eeSupported;
  }

  /**
   * Attaches encryption transform to a sender
   *
   * @param sender - The RTCRtpSender to attach to
   */
  attachToSender(sender: RTCRtpSender): void {
    if (!this.capabilities.insertableStreams && !this.capabilities.encodedTransform) {
      throw new Error('E2EE not supported in this Firefox version');
    }

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
          // Pass through on error to maintain call continuity
          controller.enqueue(frame);
        }
      },
    });

    (sender as RTCRtpSender & { transform: TransformStream }).transform = this.encryptTransform;
  }

  /**
   * Attaches decryption transform to a receiver
   *
   * @param receiver - The RTCRtpReceiver to attach to
   */
  attachToReceiver(receiver: RTCRtpReceiver): void {
    if (!this.capabilities.insertableStreams && !this.capabilities.encodedTransform) {
      throw new Error('E2EE not supported in this Firefox version');
    }

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
      console.log(`[FirefoxE2EE ${this.config.participantId}]`, ...args);
    }
  }
}

/**
 * Detects Firefox capabilities for E2EE
 */
export function detectFirefoxCapabilities(): FirefoxCapabilities {
  const capabilities: FirefoxCapabilities = {
    insertableStreams: false,
    scriptTransform: false,
    encodedTransform: false,
    version: null,
    e2eeSupported: false,
  };

  // Detect Firefox version
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const firefoxMatch = userAgent.match(/Firefox\/(\d+)/);
  if (firefoxMatch !== null) {
    capabilities.version = parseInt(firefoxMatch[1], 10);
  }

  // Check for RTCRtpSender.transform (Insertable Streams)
  if (typeof RTCRtpSender !== 'undefined') {
    const senderProto = Object.getOwnPropertyDescriptor(RTCRtpSender.prototype, 'transform');
    capabilities.insertableStreams = senderProto !== undefined;
  }

  // Check for RTCRtpScriptTransform
  capabilities.scriptTransform = 'RTCRtpScriptTransform' in globalThis;

  // Firefox 117+ has partial Insertable Streams support
  // Firefox 118+ has better support
  if (capabilities.version !== null && capabilities.version >= 117) {
    capabilities.encodedTransform = capabilities.insertableStreams;
  }

  // E2EE is supported if we have any of the transform APIs
  capabilities.e2eeSupported =
    capabilities.insertableStreams || capabilities.scriptTransform || capabilities.encodedTransform;

  return capabilities;
}

/**
 * Creates E2EE transforms for Firefox
 */
export function createFirefoxE2EE(config: FirefoxE2EEConfig): FirefoxE2EETransform {
  return new FirefoxE2EETransform(config);
}

/**
 * Checks if Firefox E2EE is supported
 */
export function isFirefoxE2EESupported(): boolean {
  const capabilities = detectFirefoxCapabilities();
  return capabilities.e2eeSupported;
}

/**
 * Gets the minimum Firefox version required for E2EE
 */
export function getMinSupportedFirefoxVersion(): number {
  return 117;
}

/**
 * Feature flags for Firefox E2EE
 */
export const FIREFOX_FEATURE_FLAGS = {
  /** Minimum version for Insertable Streams */
  INSERTABLE_STREAMS_MIN_VERSION: 117,
  /** Minimum version for stable E2EE */
  STABLE_E2EE_MIN_VERSION: 118,
  /** Enable workarounds for Firefox quirks */
  ENABLE_QUIRKS_MODE: true,
} as const;
