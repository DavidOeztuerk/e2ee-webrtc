/**
 * @fileoverview Unit tests for Key Manager
 * TDD: Tests written BEFORE implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KeyManager } from '@core/key-manager';
import type { KeyGeneration, EncryptionState } from '@/types';

describe('Key Manager Module', () => {
  let keyManager: KeyManager;

  beforeEach(() => {
    keyManager = new KeyManager({
      keyHistorySize: 5,
      autoRotate: false,
      rotationIntervalMs: 30000,
    });
  });

  afterEach(() => {
    keyManager.destroy();
  });

  // =========================================================================
  // Initialization Tests
  // =========================================================================
  describe('Initialization', () => {
    it('should create a new KeyManager instance', () => {
      expect(keyManager).toBeDefined();
      expect(keyManager).toBeInstanceOf(KeyManager);
    });

    it('should start with no active key', () => {
      const state = keyManager.getState();

      expect(state.currentKey).toBeNull();
      expect(state.isActive).toBe(false);
    });

    it('should start with generation 0', () => {
      const state = keyManager.getState();

      expect(state.currentGeneration).toBe(0);
    });

    it('should have empty key history initially', () => {
      const state = keyManager.getState();

      expect(state.keyHistory.size).toBe(0);
    });
  });

  // =========================================================================
  // Key Generation Tests
  // =========================================================================
  describe('generateKey', () => {
    it('should generate a new encryption key', async () => {
      const key = await keyManager.generateKey();

      expect(key).toBeDefined();
      expect(key.algorithm.name).toBe('AES-GCM');
    });

    it('should increment generation on each key generation', async () => {
      await keyManager.generateKey();
      expect(keyManager.getState().currentGeneration).toBe(1);

      await keyManager.generateKey();
      expect(keyManager.getState().currentGeneration).toBe(2);

      await keyManager.generateKey();
      expect(keyManager.getState().currentGeneration).toBe(3);
    });

    it('should wrap generation at 255', async () => {
      // Set generation to 255
      for (let i = 0; i < 255; i++) {
        await keyManager.generateKey();
      }
      expect(keyManager.getState().currentGeneration).toBe(255);

      // Next generation should wrap to 0
      await keyManager.generateKey();
      expect(keyManager.getState().currentGeneration).toBe(0);
    });

    it('should set previous key when generating new key', async () => {
      const key1 = await keyManager.generateKey();
      const state1 = keyManager.getState();
      expect(state1.previousKey).toBeNull();

      const key2 = await keyManager.generateKey();
      const state2 = keyManager.getState();
      expect(state2.previousKey).not.toBeNull();
      // Previous key should be exportable to verify it's key1
    });

    it('should add key to history', async () => {
      await keyManager.generateKey();
      expect(keyManager.getState().keyHistory.size).toBe(1);

      await keyManager.generateKey();
      expect(keyManager.getState().keyHistory.size).toBe(2);
    });

    it('should limit key history to configured size', async () => {
      // Generate more keys than history size (5)
      for (let i = 0; i < 10; i++) {
        await keyManager.generateKey();
      }

      expect(keyManager.getState().keyHistory.size).toBe(5);
    });

    it('should emit key-generated event', async () => {
      const handler = vi.fn();
      keyManager.on('key-generated', handler);

      await keyManager.generateKey();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          generation: 1,
        })
      );
    });

    it('should set isActive to true after first key generation', async () => {
      expect(keyManager.getState().isActive).toBe(false);

      await keyManager.generateKey();

      expect(keyManager.getState().isActive).toBe(true);
    });
  });

  // =========================================================================
  // Key Setting Tests
  // =========================================================================
  describe('setKey', () => {
    it('should set a key with specific generation', async () => {
      const mockKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
        'encrypt',
        'decrypt',
      ]);

      await keyManager.setKey(mockKey as CryptoKey, 42);

      const state = keyManager.getState();
      expect(state.currentGeneration).toBe(42);
      expect(state.currentKey).not.toBeNull();
    });

    it('should move current key to previous when setting new key', async () => {
      const key1 = (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
        'encrypt',
        'decrypt',
      ])) as CryptoKey;

      const key2 = (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
        'encrypt',
        'decrypt',
      ])) as CryptoKey;

      await keyManager.setKey(key1, 1);
      const state1 = keyManager.getState();
      expect(state1.previousKey).toBeNull();

      await keyManager.setKey(key2, 2);
      const state2 = keyManager.getState();
      expect(state2.previousKey).not.toBeNull();
      expect(state2.previousGeneration).toBe(1);
    });

    it('should add key to history', async () => {
      const mockKey = (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
        'encrypt',
        'decrypt',
      ])) as CryptoKey;

      await keyManager.setKey(mockKey, 5);

      expect(keyManager.getState().keyHistory.has(5)).toBe(true);
    });

    it('should emit key-set event', async () => {
      const handler = vi.fn();
      keyManager.on('key-set', handler);

      const mockKey = (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
        'encrypt',
        'decrypt',
      ])) as CryptoKey;

      await keyManager.setKey(mockKey, 10);

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Key Retrieval Tests
  // =========================================================================
  describe('getKeyForGeneration', () => {
    it('should return current key for current generation', async () => {
      await keyManager.generateKey();
      const generation = keyManager.getState().currentGeneration;

      const key = keyManager.getKeyForGeneration(generation);

      expect(key).not.toBeNull();
    });

    it('should return previous key for previous generation', async () => {
      await keyManager.generateKey();
      await keyManager.generateKey();

      const state = keyManager.getState();
      const previousKey = keyManager.getKeyForGeneration(state.previousGeneration);

      expect(previousKey).not.toBeNull();
    });

    it('should return key from history for older generations', async () => {
      // Generate 3 keys
      await keyManager.generateKey(); // gen 1
      await keyManager.generateKey(); // gen 2
      await keyManager.generateKey(); // gen 3

      // Should still be able to get gen 1
      const key = keyManager.getKeyForGeneration(1);

      expect(key).not.toBeNull();
    });

    it('should return null for unknown generation', async () => {
      await keyManager.generateKey();

      const key = keyManager.getKeyForGeneration(99);

      expect(key).toBeNull();
    });

    it('should return null for expired generation (not in history)', async () => {
      // Generate more keys than history size
      for (let i = 0; i < 10; i++) {
        await keyManager.generateKey();
      }

      // Generation 1 should have been evicted
      const key = keyManager.getKeyForGeneration(1);

      expect(key).toBeNull();
    });
  });

  // =========================================================================
  // Key Rotation Tests
  // =========================================================================
  describe('Key Rotation', () => {
    it('should rotate key and increment generation', async () => {
      await keyManager.generateKey();
      const initialGeneration = keyManager.getState().currentGeneration;

      await keyManager.rotateKey();

      expect(keyManager.getState().currentGeneration).toBe(initialGeneration + 1);
    });

    it('should emit key-rotated event', async () => {
      await keyManager.generateKey();

      const handler = vi.fn();
      keyManager.on('key-rotated', handler);

      await keyManager.rotateKey();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should preserve previous key after rotation', async () => {
      await keyManager.generateKey();
      await keyManager.rotateKey();

      const state = keyManager.getState();

      expect(state.previousKey).not.toBeNull();
    });

    it('should auto-rotate when enabled', async () => {
      vi.useFakeTimers();

      const autoRotateManager = new KeyManager({
        keyHistorySize: 5,
        autoRotate: true,
        rotationIntervalMs: 1000,
      });

      await autoRotateManager.generateKey();
      const initialGeneration = autoRotateManager.getState().currentGeneration;

      // Fast-forward time by exactly 1100ms (avoid infinite loop from runAllTimersAsync)
      await vi.advanceTimersByTimeAsync(1100);

      expect(autoRotateManager.getState().currentGeneration).toBeGreaterThan(initialGeneration);

      autoRotateManager.destroy();
      vi.useRealTimers();
    });

    it('should stop auto-rotation on destroy', async () => {
      vi.useFakeTimers();

      const autoRotateManager = new KeyManager({
        keyHistorySize: 5,
        autoRotate: true,
        rotationIntervalMs: 1000,
      });

      await autoRotateManager.generateKey();
      const handler = vi.fn();
      autoRotateManager.on('key-rotated', handler);

      autoRotateManager.destroy();

      // After destroy, no timers should fire
      await vi.advanceTimersByTimeAsync(5000);

      expect(handler).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // Key Export/Import Tests
  // =========================================================================
  describe('exportCurrentKey / importKey', () => {
    it('should export current key as bytes', async () => {
      await keyManager.generateKey();

      const exported = await keyManager.exportCurrentKey();

      expect(exported).toBeInstanceOf(Uint8Array);
      expect(exported.length).toBe(32); // AES-256
    });

    it('should throw if no key to export', async () => {
      await expect(keyManager.exportCurrentKey()).rejects.toThrow();
    });

    it('should import key correctly', async () => {
      await keyManager.generateKey();
      const exported = await keyManager.exportCurrentKey();
      const generation = keyManager.getState().currentGeneration;

      // Create new manager and import
      const newManager = new KeyManager({ keyHistorySize: 5 });
      await newManager.importKey(exported, generation);

      const state = newManager.getState();
      expect(state.currentGeneration).toBe(generation);
      expect(state.currentKey).not.toBeNull();

      newManager.destroy();
    });
  });

  // =========================================================================
  // Fingerprint Tests
  // =========================================================================
  describe('Fingerprints', () => {
    it('should compute fingerprint for current key', async () => {
      await keyManager.generateKey();

      const fingerprint = await keyManager.getCurrentKeyFingerprint();

      expect(fingerprint).toBeInstanceOf(Uint8Array);
      expect(fingerprint.length).toBe(32);
    });

    it('should return consistent fingerprint for same key', async () => {
      await keyManager.generateKey();

      const fp1 = await keyManager.getCurrentKeyFingerprint();
      const fp2 = await keyManager.getCurrentKeyFingerprint();

      expect(fp1).toEqual(fp2);
    });

    it('should return different fingerprint for different keys', async () => {
      await keyManager.generateKey();
      const fp1 = await keyManager.getCurrentKeyFingerprint();

      await keyManager.generateKey();
      const fp2 = await keyManager.getCurrentKeyFingerprint();

      expect(fp1).not.toEqual(fp2);
    });

    it('should format fingerprint as hex string', async () => {
      await keyManager.generateKey();

      const formatted = await keyManager.getFormattedFingerprint();

      expect(formatted).toMatch(/^([A-F0-9]{2}:){31}[A-F0-9]{2}$/);
    });
  });

  // =========================================================================
  // Security Tests
  // =========================================================================
  describe('Security', () => {
    it('should zeroize keys on destroy', async () => {
      await keyManager.generateKey();

      keyManager.destroy();

      const state = keyManager.getState();
      expect(state.currentKey).toBeNull();
      expect(state.previousKey).toBeNull();
      expect(state.keyHistory.size).toBe(0);
    });

    it('should not allow operations after destroy', async () => {
      keyManager.destroy();

      await expect(keyManager.generateKey()).rejects.toThrow();
    });

    it('should clear key history when clearHistory is called', async () => {
      await keyManager.generateKey();
      await keyManager.generateKey();
      await keyManager.generateKey();

      expect(keyManager.getState().keyHistory.size).toBeGreaterThan(0);

      keyManager.clearHistory();

      expect(keyManager.getState().keyHistory.size).toBe(0);
    });
  });

  // =========================================================================
  // Event Tests
  // =========================================================================
  describe('Events', () => {
    it('should support multiple event listeners', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      keyManager.on('key-generated', handler1);
      keyManager.on('key-generated', handler2);

      await keyManager.generateKey();

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should remove event listener with off', async () => {
      const handler = vi.fn();

      keyManager.on('key-generated', handler);
      keyManager.off('key-generated', handler);

      await keyManager.generateKey();

      expect(handler).not.toHaveBeenCalled();
    });

    it('should support once listeners', async () => {
      const handler = vi.fn();

      keyManager.once('key-generated', handler);

      await keyManager.generateKey();
      await keyManager.generateKey();

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // State Snapshot Tests
  // =========================================================================
  describe('getState', () => {
    it('should return immutable state snapshot', async () => {
      await keyManager.generateKey();

      const state1 = keyManager.getState();
      const state2 = keyManager.getState();

      // Should be equal but not same reference
      expect(state1).toEqual(state2);
      expect(state1).not.toBe(state2);
    });

    it('should include all encryption state properties', async () => {
      await keyManager.generateKey();

      const state = keyManager.getState();

      expect(state).toHaveProperty('currentKey');
      expect(state).toHaveProperty('currentGeneration');
      expect(state).toHaveProperty('previousKey');
      expect(state).toHaveProperty('previousGeneration');
      expect(state).toHaveProperty('keyHistory');
      expect(state).toHaveProperty('isActive');
    });
  });
});
