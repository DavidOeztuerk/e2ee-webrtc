/**
 * Test Setup File
 * Configures the test environment with mocks for Web APIs
 */

import { vi } from 'vitest';

// Mock crypto.subtle for Node.js environment
if (typeof globalThis.crypto === 'undefined') {
  // @ts-expect-error - Mocking global crypto
  globalThis.crypto = {
    subtle: {
      generateKey: vi.fn(),
      exportKey: vi.fn(),
      importKey: vi.fn(),
      encrypt: vi.fn(),
      decrypt: vi.fn(),
      deriveBits: vi.fn(),
      deriveKey: vi.fn(),
      sign: vi.fn(),
      verify: vi.fn(),
      digest: vi.fn(),
    },
    getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
      if (array === null) return array;
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
      return array;
    },
    randomUUID: () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    },
  };
}

// Mock RTCRtpSender/Receiver for Insertable Streams
class MockRTCRtpSender {
  createEncodedStreams(): { readable: ReadableStream; writable: WritableStream } {
    return {
      readable: new ReadableStream(),
      writable: new WritableStream(),
    };
  }
}

class MockRTCRtpReceiver {
  createEncodedStreams(): { readable: ReadableStream; writable: WritableStream } {
    return {
      readable: new ReadableStream(),
      writable: new WritableStream(),
    };
  }
}

// @ts-expect-error - Mocking global
globalThis.RTCRtpSender = MockRTCRtpSender;
// @ts-expect-error - Mocking global
globalThis.RTCRtpReceiver = MockRTCRtpReceiver;

// Mock Worker
class MockWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;

  constructor(public url: string | URL) {}

  postMessage(_data: unknown): void {
    // Mock implementation
  }

  terminate(): void {
    // Mock implementation
  }

  addEventListener(_type: string, _listener: EventListener): void {
    // Mock implementation
  }

  removeEventListener(_type: string, _listener: EventListener): void {
    // Mock implementation
  }
}

// @ts-expect-error - Mocking global
globalThis.Worker = MockWorker;

// Test utilities
export const createMockCryptoKey = (): CryptoKey => {
  return {
    algorithm: { name: 'AES-GCM', length: 256 },
    extractable: true,
    type: 'secret',
    usages: ['encrypt', 'decrypt'],
  } as CryptoKey;
};

export const createMockKeyPair = (): CryptoKeyPair => {
  return {
    publicKey: {
      algorithm: { name: 'ECDH', namedCurve: 'P-256' },
      extractable: true,
      type: 'public',
      usages: [],
    } as CryptoKey,
    privateKey: {
      algorithm: { name: 'ECDH', namedCurve: 'P-256' },
      extractable: true,
      type: 'private',
      usages: ['deriveBits', 'deriveKey'],
    } as CryptoKey,
  };
};

export const createMockEncodedFrame = (
  data: Uint8Array,
  type: 'key' | 'delta' = 'delta'
): { data: ArrayBuffer; type: string } => {
  return {
    data: data.buffer,
    type,
  };
};

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});
