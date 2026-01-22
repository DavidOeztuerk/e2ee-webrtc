/**
 * @module browser/detection
 * Browser detection and capability checking for E2EE WebRTC
 *
 * @description
 * Detects browser type, version, and E2EE capabilities:
 * - Chrome/Chromium: Insertable Streams API
 * - Safari: RTCRtpScriptTransform API
 * - Firefox: Currently not supported for E2EE
 */

import type { BrowserCapabilities, BrowserType, E2EEMethod } from '../../types';

/** Minimum Chrome version for Insertable Streams */
const MIN_CHROME_VERSION = 86;

/** Minimum Safari version for Script Transform */
const MIN_SAFARI_VERSION = 15.4;

/** User agent regex patterns */
const UA_PATTERNS = {
  edge: /Edg\/(\d+(?:\.\d+)*)/,
  chrome: /Chrome\/(\d+(?:\.\d+)*)/,
  safari: /Version\/(\d+(?:\.\d+)*)\s+Safari/,
  firefox: /Firefox\/(\d+(?:\.\d+)*)/,
  ios: /(?:iPhone|iPad|iPod)/,
  crios: /CriOS\/(\d+(?:\.\d+)*)/,
} as const;

/**
 * Detects the current browser type and version
 *
 * @returns Object with browser type and version
 *
 * @example
 * ```typescript
 * const { browser, version } = detectBrowser();
 * console.log(`Running on ${browser} ${version}`);
 * ```
 */
export function detectBrowser(): { browser: BrowserType; version: string } {
  if (typeof navigator === 'undefined') {
    return { browser: 'unknown', version: '' };
  }

  const ua = navigator.userAgent;

  if (!ua) {
    return { browser: 'unknown', version: '' };
  }

  // Check for iOS (all iOS browsers use WebKit/Safari engine)
  if (UA_PATTERNS.ios.test(ua)) {
    const safariMatch = ua.match(UA_PATTERNS.safari);
    return {
      browser: 'safari',
      version: safariMatch?.[1] ?? '',
    };
  }

  // Check Edge first (it includes "Chrome" in UA)
  const edgeMatch = ua.match(UA_PATTERNS.edge);
  if (edgeMatch) {
    return {
      browser: 'edge',
      version: edgeMatch[1] ?? '',
    };
  }

  // Check Chrome (but not Edge)
  const chromeMatch = ua.match(UA_PATTERNS.chrome);
  if (chromeMatch && !ua.includes('Edg/')) {
    return {
      browser: 'chrome',
      version: chromeMatch[1] ?? '',
    };
  }

  // Check Safari (macOS)
  const safariMatch = ua.match(UA_PATTERNS.safari);
  if (safariMatch && !chromeMatch) {
    return {
      browser: 'safari',
      version: safariMatch[1] ?? '',
    };
  }

  // Check Firefox
  const firefoxMatch = ua.match(UA_PATTERNS.firefox);
  if (firefoxMatch) {
    return {
      browser: 'firefox',
      version: firefoxMatch[1] ?? '',
    };
  }

  return { browser: 'unknown', version: '' };
}

/**
 * Checks if Insertable Streams API is available
 *
 * @returns true if browser supports Insertable Streams
 */
function supportsInsertableStreams(): boolean {
  if (typeof RTCRtpSender === 'undefined') {
    return false;
  }

  // Check for createEncodedStreams method
  return 'createEncodedStreams' in RTCRtpSender.prototype;
}

/**
 * Checks if RTCRtpScriptTransform API is available
 *
 * @returns true if browser supports Script Transform
 */
function supportsScriptTransform(): boolean {
  return typeof RTCRtpScriptTransform !== 'undefined';
}

/**
 * Checks if Web Workers are available
 *
 * @returns true if browser supports Workers
 */
function supportsWorkers(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * Checks if SharedArrayBuffer is available
 *
 * @returns true if browser supports SharedArrayBuffer
 */
function supportsSharedArrayBuffer(): boolean {
  if (typeof SharedArrayBuffer === 'undefined') {
    return false;
  }

  // Also check for cross-origin isolation (required in modern browsers)
  if (typeof crossOriginIsolated !== 'undefined') {
    return crossOriginIsolated;
  }

  return true;
}

/**
 * Checks if WebAssembly is available
 *
 * @returns true if browser supports WebAssembly
 */
function supportsWasm(): boolean {
  return typeof WebAssembly !== 'undefined' && typeof WebAssembly.instantiate === 'function';
}

/**
 * Detects all browser capabilities for E2EE
 *
 * @returns Full capabilities object
 *
 * @example
 * ```typescript
 * const caps = detectCapabilities();
 * if (caps.supportsInsertableStreams) {
 *   // Use Chrome's Insertable Streams API
 * } else if (caps.supportsScriptTransform) {
 *   // Use Safari's Script Transform API
 * }
 * ```
 */
export function detectCapabilities(): BrowserCapabilities {
  const { browser, version } = detectBrowser();

  const hasInsertableStreams = supportsInsertableStreams();
  const hasScriptTransform = supportsScriptTransform();
  const hasWorkers = supportsWorkers();

  // Determine best E2EE method
  let e2eeMethod: E2EEMethod = 'none';
  if (hasWorkers) {
    if (hasInsertableStreams) {
      e2eeMethod = 'insertable-streams';
    } else if (hasScriptTransform) {
      e2eeMethod = 'script-transform';
    }
  }

  return {
    browser,
    version,
    e2eeMethod,
    supportsInsertableStreams: hasInsertableStreams,
    supportsScriptTransform: hasScriptTransform,
    supportsWorkers: hasWorkers,
    supportsSharedArrayBuffer: supportsSharedArrayBuffer(),
    supportsWasm: supportsWasm(),
  };
}

/**
 * Gets the best E2EE method based on capabilities
 *
 * @param capabilities - Browser capabilities
 * @returns The best available E2EE method
 */
export function getBestE2EEMethod(capabilities: BrowserCapabilities): E2EEMethod {
  // Workers are required for any E2EE method
  if (!capabilities.supportsWorkers) {
    return 'none';
  }

  // Prefer Insertable Streams (more mature, better performance)
  if (capabilities.supportsInsertableStreams) {
    return 'insertable-streams';
  }

  // Fall back to Script Transform (Safari)
  if (capabilities.supportsScriptTransform) {
    return 'script-transform';
  }

  return 'none';
}

/**
 * Checks if E2EE is supported in the current browser
 *
 * @returns true if E2EE is supported
 *
 * @example
 * ```typescript
 * if (!isE2EESupported()) {
 *   showWarning('E2EE not supported in your browser');
 * }
 * ```
 */
export function isE2EESupported(): boolean {
  const capabilities = detectCapabilities();
  return capabilities.e2eeMethod !== 'none';
}

/**
 * Gets the appropriate worker URL for the E2EE method
 *
 * @param method - The E2EE method
 * @param basePath - Base path for worker files (default: '/workers/')
 * @returns Worker URL or empty string if not applicable
 *
 * @example
 * ```typescript
 * const workerUrl = getWorkerUrl('insertable-streams');
 * const worker = new Worker(workerUrl, { type: 'module' });
 * ```
 */
export function getWorkerUrl(method: E2EEMethod, basePath = '/workers/'): string {
  switch (method) {
    case 'insertable-streams':
      return `${basePath}chrome-e2ee-worker.js`;
    case 'script-transform':
      return `${basePath}safari-e2ee-worker.js`;
    default:
      return '';
  }
}

/**
 * Parses a version string to a number for comparison
 *
 * @param version - Version string like "120.0.0.0"
 * @returns Major version number
 */
export function parseVersion(version: string): number {
  const parts = version.split('.');
  return parseInt(parts[0] ?? '0', 10);
}

/**
 * Checks if the browser meets minimum version requirements
 *
 * @param browser - Browser type
 * @param version - Version string
 * @returns true if version is sufficient for E2EE
 */
export function meetsMinimumVersion(browser: BrowserType, version: string): boolean {
  const majorVersion = parseVersion(version);

  switch (browser) {
    case 'chrome':
    case 'edge':
      return majorVersion >= MIN_CHROME_VERSION;
    case 'safari':
      return majorVersion >= MIN_SAFARI_VERSION;
    default:
      return false;
  }
}

/**
 * Gets a human-readable description of E2EE support
 *
 * @returns Description string
 */
export function getE2EESupportDescription(): string {
  const capabilities = detectCapabilities();
  const { browser, version, e2eeMethod } = capabilities;

  if (e2eeMethod === 'none') {
    return `E2EE is not supported on ${browser} ${version}. ` +
      'Please use Chrome 86+, Edge 86+, or Safari 15.4+.';
  }

  const methodName = e2eeMethod === 'insertable-streams'
    ? 'Insertable Streams'
    : 'Script Transform';

  return `E2EE is supported using ${methodName} on ${browser} ${version}`;
}
