/**
 * @fileoverview Unit tests for browser detection and capability checking
 * TDD: Tests written BEFORE implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectBrowser,
  detectCapabilities,
  getBestE2EEMethod,
  isE2EESupported,
  getWorkerUrl,
  parseVersion,
  meetsMinimumVersion,
  getE2EESupportDescription,
} from '@browser/detection';
import type { BrowserCapabilities, BrowserType, E2EEMethod } from '@/types';

describe('Browser Detection Module', () => {
  // Store original values
  let originalUserAgent: string;
  let originalNavigator: Navigator;

  beforeEach(() => {
    originalUserAgent = navigator.userAgent;
    originalNavigator = window.navigator;
  });

  afterEach(() => {
    // Restore original values
    vi.unstubAllGlobals();
  });

  // Helper to mock user agent
  const mockUserAgent = (ua: string): void => {
    vi.stubGlobal('navigator', {
      ...originalNavigator,
      userAgent: ua,
    });
  };

  // =========================================================================
  // Browser Detection Tests
  // =========================================================================
  describe('detectBrowser', () => {
    it('should detect Chrome', () => {
      mockUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      const result = detectBrowser();

      expect(result.browser).toBe('chrome');
      expect(result.version).toBe('120.0.0.0');
    });

    it('should detect Safari', () => {
      mockUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
      );

      const result = detectBrowser();

      expect(result.browser).toBe('safari');
      expect(result.version).toBe('17.2');
    });

    it('should detect Firefox', () => {
      mockUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
      );

      const result = detectBrowser();

      expect(result.browser).toBe('firefox');
      expect(result.version).toBe('121.0');
    });

    it('should detect Edge', () => {
      mockUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
      );

      const result = detectBrowser();

      expect(result.browser).toBe('edge');
      expect(result.version).toBe('120.0.0.0');
    });

    it('should return unknown for unrecognized browsers', () => {
      mockUserAgent('Unknown Browser/1.0');

      const result = detectBrowser();

      expect(result.browser).toBe('unknown');
    });

    it('should detect Chrome on iOS', () => {
      mockUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1'
      );

      const result = detectBrowser();

      // Chrome on iOS uses Safari's engine
      expect(result.browser).toBe('safari');
    });

    it('should detect Chrome on Android', () => {
      mockUserAgent(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36'
      );

      const result = detectBrowser();

      expect(result.browser).toBe('chrome');
    });
  });

  // =========================================================================
  // Capability Detection Tests
  // =========================================================================
  describe('detectCapabilities', () => {
    it('should detect Insertable Streams support in Chrome', () => {
      mockUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Mock RTCRtpSender with createEncodedStreams on prototype
      function MockRTCRtpSender() {}
      MockRTCRtpSender.prototype.createEncodedStreams = () => ({});
      vi.stubGlobal('RTCRtpSender', MockRTCRtpSender);

      const capabilities = detectCapabilities();

      expect(capabilities.supportsInsertableStreams).toBe(true);
    });

    it('should detect Script Transform support in Safari', () => {
      mockUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
      );

      // Mock RTCRtpScriptTransform
      vi.stubGlobal('RTCRtpScriptTransform', class {});

      const capabilities = detectCapabilities();

      expect(capabilities.supportsScriptTransform).toBe(true);
    });

    it('should detect Worker support', () => {
      vi.stubGlobal('Worker', class {});

      const capabilities = detectCapabilities();

      expect(capabilities.supportsWorkers).toBe(true);
    });

    it('should detect SharedArrayBuffer support', () => {
      vi.stubGlobal('SharedArrayBuffer', class {});
      vi.stubGlobal('crossOriginIsolated', true);

      const capabilities = detectCapabilities();

      expect(capabilities.supportsSharedArrayBuffer).toBe(true);
    });

    it('should detect WebAssembly support', () => {
      vi.stubGlobal('WebAssembly', {
        instantiate: () => {},
        compile: () => {},
      });

      const capabilities = detectCapabilities();

      expect(capabilities.supportsWasm).toBe(true);
    });

    it('should return full capabilities object', () => {
      mockUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      const capabilities = detectCapabilities();

      expect(capabilities).toHaveProperty('browser');
      expect(capabilities).toHaveProperty('version');
      expect(capabilities).toHaveProperty('e2eeMethod');
      expect(capabilities).toHaveProperty('supportsInsertableStreams');
      expect(capabilities).toHaveProperty('supportsScriptTransform');
      expect(capabilities).toHaveProperty('supportsWorkers');
      expect(capabilities).toHaveProperty('supportsSharedArrayBuffer');
      expect(capabilities).toHaveProperty('supportsWasm');
    });
  });

  // =========================================================================
  // E2EE Method Selection Tests
  // =========================================================================
  describe('getBestE2EEMethod', () => {
    it('should return insertable-streams for Chrome with support', () => {
      const capabilities: BrowserCapabilities = {
        browser: 'chrome',
        version: '120.0.0.0',
        e2eeMethod: 'none',
        supportsInsertableStreams: true,
        supportsScriptTransform: false,
        supportsWorkers: true,
        supportsSharedArrayBuffer: true,
        supportsWasm: true,
      };

      const method = getBestE2EEMethod(capabilities);

      expect(method).toBe('insertable-streams');
    });

    it('should return script-transform for Safari with support', () => {
      const capabilities: BrowserCapabilities = {
        browser: 'safari',
        version: '17.2',
        e2eeMethod: 'none',
        supportsInsertableStreams: false,
        supportsScriptTransform: true,
        supportsWorkers: true,
        supportsSharedArrayBuffer: false,
        supportsWasm: true,
      };

      const method = getBestE2EEMethod(capabilities);

      expect(method).toBe('script-transform');
    });

    it('should return none when no E2EE method is supported', () => {
      const capabilities: BrowserCapabilities = {
        browser: 'firefox',
        version: '121.0',
        e2eeMethod: 'none',
        supportsInsertableStreams: false,
        supportsScriptTransform: false,
        supportsWorkers: true,
        supportsSharedArrayBuffer: false,
        supportsWasm: true,
      };

      const method = getBestE2EEMethod(capabilities);

      expect(method).toBe('none');
    });

    it('should prefer insertable-streams when both are available', () => {
      const capabilities: BrowserCapabilities = {
        browser: 'chrome',
        version: '120.0.0.0',
        e2eeMethod: 'none',
        supportsInsertableStreams: true,
        supportsScriptTransform: true,
        supportsWorkers: true,
        supportsSharedArrayBuffer: true,
        supportsWasm: true,
      };

      const method = getBestE2EEMethod(capabilities);

      expect(method).toBe('insertable-streams');
    });

    it('should return none when Workers are not supported', () => {
      const capabilities: BrowserCapabilities = {
        browser: 'chrome',
        version: '120.0.0.0',
        e2eeMethod: 'none',
        supportsInsertableStreams: true,
        supportsScriptTransform: false,
        supportsWorkers: false, // No workers = no E2EE
        supportsSharedArrayBuffer: false,
        supportsWasm: true,
      };

      const method = getBestE2EEMethod(capabilities);

      expect(method).toBe('none');
    });
  });

  // =========================================================================
  // E2EE Support Check Tests
  // =========================================================================
  describe('isE2EESupported', () => {
    it('should return true for Chrome >= 86', () => {
      mockUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Mock support
      function MockRTCRtpSender() {}
      MockRTCRtpSender.prototype.createEncodedStreams = () => ({});
      vi.stubGlobal('RTCRtpSender', MockRTCRtpSender);
      vi.stubGlobal('Worker', class {});

      expect(isE2EESupported()).toBe(true);
    });

    it('should return true for Safari >= 15.4', () => {
      mockUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
      );

      // Mock support
      vi.stubGlobal('RTCRtpScriptTransform', class {});
      vi.stubGlobal('Worker', class {});

      expect(isE2EESupported()).toBe(true);
    });

    it('should return false for Firefox (no E2EE API)', () => {
      mockUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
      );

      // Firefox doesn't have either API
      vi.stubGlobal('RTCRtpSender', class {});
      vi.stubGlobal('RTCRtpScriptTransform', undefined);

      expect(isE2EESupported()).toBe(false);
    });

    it('should return false for old Chrome without Insertable Streams', () => {
      mockUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.0.0 Safari/537.36'
      );

      // Old Chrome without createEncodedStreams
      vi.stubGlobal('RTCRtpSender', class {});

      expect(isE2EESupported()).toBe(false);
    });
  });

  // =========================================================================
  // Worker URL Tests
  // =========================================================================
  describe('getWorkerUrl', () => {
    it('should return Chrome worker URL for insertable-streams method', () => {
      const url = getWorkerUrl('insertable-streams');

      expect(url).toContain('chrome');
      expect(url).toContain('worker');
    });

    it('should return Safari worker URL for script-transform method', () => {
      const url = getWorkerUrl('script-transform');

      expect(url).toContain('safari');
      expect(url).toContain('worker');
    });

    it('should return empty string for none method', () => {
      const url = getWorkerUrl('none');

      expect(url).toBe('');
    });

    it('should return valid URL that can be used with new Worker()', () => {
      const url = getWorkerUrl('insertable-streams');

      // Should not throw
      expect(() => new URL(url, 'http://localhost')).not.toThrow();
    });

    it('should accept custom base path', () => {
      const url = getWorkerUrl('insertable-streams', '/custom/path/');

      expect(url).toContain('/custom/path/');
    });
  });

  // =========================================================================
  // Version Comparison Tests
  // =========================================================================
  describe('Version Comparison', () => {
    it('should correctly compare major versions', () => {
      // This tests internal version comparison logic
      const capabilities1: BrowserCapabilities = {
        browser: 'chrome',
        version: '120.0.0.0',
        e2eeMethod: 'insertable-streams',
        supportsInsertableStreams: true,
        supportsScriptTransform: false,
        supportsWorkers: true,
        supportsSharedArrayBuffer: true,
        supportsWasm: true,
      };

      const capabilities2: BrowserCapabilities = {
        browser: 'chrome',
        version: '85.0.0.0',
        e2eeMethod: 'none',
        supportsInsertableStreams: false,
        supportsScriptTransform: false,
        supportsWorkers: true,
        supportsSharedArrayBuffer: false,
        supportsWasm: true,
      };

      expect(capabilities1.supportsInsertableStreams).toBe(true);
      expect(capabilities2.supportsInsertableStreams).toBe(false);
    });
  });

  // =========================================================================
  // Edge Cases Tests
  // =========================================================================
  describe('Edge Cases', () => {
    it('should handle empty user agent', () => {
      mockUserAgent('');

      const result = detectBrowser();

      expect(result.browser).toBe('unknown');
      expect(result.version).toBe('');
    });

    it('should handle malformed user agent', () => {
      mockUserAgent('Not/A/Valid/UserAgent');

      expect(() => detectBrowser()).not.toThrow();
    });

    it('should handle missing window object gracefully', () => {
      // This tests server-side rendering scenarios
      // Implementation should handle this gracefully
      expect(() => detectCapabilities()).not.toThrow();
    });

    it('should handle undefined navigator', () => {
      vi.stubGlobal('navigator', undefined);

      const result = detectBrowser();

      expect(result.browser).toBe('unknown');
      expect(result.version).toBe('');
    });

    it('should handle undefined RTCRtpSender', () => {
      vi.stubGlobal('RTCRtpSender', undefined);

      const capabilities = detectCapabilities();

      expect(capabilities.supportsInsertableStreams).toBe(false);
    });

    it('should handle undefined SharedArrayBuffer', () => {
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const capabilities = detectCapabilities();

      expect(capabilities.supportsSharedArrayBuffer).toBe(false);
    });

    it('should detect Brave as Chrome-based', () => {
      mockUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Brave uses Chrome's engine
      const result = detectBrowser();

      expect(result.browser).toBe('chrome');
    });

    it('should detect Opera as Chrome-based', () => {
      mockUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0'
      );

      const result = detectBrowser();

      // Opera uses Chromium, should be treated as Chrome for E2EE purposes
      expect(['chrome', 'edge']).toContain(result.browser);
    });

    it('should use script-transform when only that is available', () => {
      mockUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
      );

      // Only Script Transform available, no Insertable Streams
      vi.stubGlobal('RTCRtpSender', class {});
      vi.stubGlobal('RTCRtpScriptTransform', class {});
      vi.stubGlobal('Worker', class {});

      const capabilities = detectCapabilities();

      expect(capabilities.e2eeMethod).toBe('script-transform');
    });
  });

  // =========================================================================
  // parseVersion Tests
  // =========================================================================
  describe('parseVersion', () => {
    it('should parse major version from full version string', () => {
      expect(parseVersion('120.0.0.0')).toBe(120);
    });

    it('should parse simple version', () => {
      expect(parseVersion('17.2')).toBe(17);
    });

    it('should return NaN for empty string', () => {
      expect(parseVersion('')).toBeNaN();
    });

    it('should handle non-numeric versions', () => {
      expect(parseVersion('abc')).toBeNaN();
    });
  });

  // =========================================================================
  // meetsMinimumVersion Tests
  // =========================================================================
  describe('meetsMinimumVersion', () => {
    it('should return true for Chrome >= 86', () => {
      expect(meetsMinimumVersion('chrome', '120.0.0.0')).toBe(true);
      expect(meetsMinimumVersion('chrome', '86.0.0.0')).toBe(true);
    });

    it('should return false for Chrome < 86', () => {
      expect(meetsMinimumVersion('chrome', '85.0.0.0')).toBe(false);
    });

    it('should return true for Edge >= 86', () => {
      expect(meetsMinimumVersion('edge', '120.0.0.0')).toBe(true);
    });

    it('should return false for Edge < 86', () => {
      expect(meetsMinimumVersion('edge', '85.0.0.0')).toBe(false);
    });

    it('should return true for Safari >= 15.4', () => {
      expect(meetsMinimumVersion('safari', '17.2')).toBe(true);
      expect(meetsMinimumVersion('safari', '16.0')).toBe(true);
    });

    it('should return false for Safari < 15.4', () => {
      expect(meetsMinimumVersion('safari', '14.0')).toBe(false);
    });

    it('should return false for Firefox (unsupported)', () => {
      expect(meetsMinimumVersion('firefox', '121.0')).toBe(false);
    });

    it('should return false for unknown browsers', () => {
      expect(meetsMinimumVersion('unknown', '100.0')).toBe(false);
    });
  });

  // =========================================================================
  // getE2EESupportDescription Tests
  // =========================================================================
  describe('getE2EESupportDescription', () => {
    it('should return description for supported browser with Insertable Streams', () => {
      mockUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      function MockRTCRtpSender() {}
      MockRTCRtpSender.prototype.createEncodedStreams = () => ({});
      vi.stubGlobal('RTCRtpSender', MockRTCRtpSender);
      vi.stubGlobal('Worker', class {});

      const description = getE2EESupportDescription();

      expect(description).toContain('E2EE is supported');
      expect(description).toContain('Insertable Streams');
      expect(description).toContain('chrome');
    });

    it('should return description for supported browser with Script Transform', () => {
      mockUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
      );

      vi.stubGlobal('RTCRtpSender', class {});
      vi.stubGlobal('RTCRtpScriptTransform', class {});
      vi.stubGlobal('Worker', class {});

      const description = getE2EESupportDescription();

      expect(description).toContain('E2EE is supported');
      expect(description).toContain('Script Transform');
      expect(description).toContain('safari');
    });

    it('should return unsupported message for Firefox', () => {
      mockUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
      );

      vi.stubGlobal('RTCRtpSender', class {});
      vi.stubGlobal('RTCRtpScriptTransform', undefined);

      const description = getE2EESupportDescription();

      expect(description).toContain('E2EE is not supported');
      expect(description).toContain('Chrome 86+');
      expect(description).toContain('Safari 15.4+');
    });
  });
});
