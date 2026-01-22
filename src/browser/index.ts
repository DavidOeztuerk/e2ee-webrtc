/**
 * @module browser
 * Browser detection and compatibility
 */

export {
  detectBrowser,
  detectCapabilities,
  getBestE2EEMethod,
  isE2EESupported,
  getWorkerUrl,
  parseVersion,
  meetsMinimumVersion,
  getE2EESupportDescription,
} from './detection';
