/**
 * Tests for SenderKeyManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SenderKeyManager } from '../../../src/sfu/sender-keys';
import type { SerializedSenderKey } from '../../../src/sfu/sender-keys';
import type { KeyGeneration } from '../../../src/types';

describe('SenderKeyManager', () => {
  let manager: SenderKeyManager;

  beforeEach(() => {
    manager = new SenderKeyManager({
      participantId: 'local-user',
    });
  });

  describe('constructor', () => {
    it('should create manager with default config', () => {
      expect(manager.participantId).toBe('local-user');
      expect(manager.currentKey).toBeNull();
      expect(manager.participants).toEqual([]);
    });

    it('should use provided config values', () => {
      const customManager = new SenderKeyManager({
        participantId: 'custom',
        enableRatcheting: false,
        ratchetInterval: 50,
        maxKeyHistory: 3,
      });

      expect(customManager.participantId).toBe('custom');
    });
  });

  describe('generateLocalKey', () => {
    it('should generate a new local key', async () => {
      const key = await manager.generateLocalKey();

      expect(key).toBeDefined();
      expect(key.participantId).toBe('local-user');
      expect(key.generation).toBe(0);
      expect(key.key).toBeDefined();
      expect(key.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('should increment generation on subsequent calls', async () => {
      await manager.generateLocalKey();
      const secondKey = await manager.generateLocalKey();

      expect(secondKey.generation).toBe(1);
    });

    it('should wrap generation at 255', async () => {
      // Generate 256 keys to wrap around (0-255)
      for (let i = 0; i < 256; i++) {
        await manager.generateLocalKey();
      }

      // 256th key should wrap to 0
      const wrappedKey = await manager.generateLocalKey();
      expect(wrappedKey.generation).toBe(0); // Wrapped from 255 -> 0
    });

    it('should include local participant in participants list', async () => {
      await manager.generateLocalKey();
      expect(manager.participants).toContain('local-user');
    });

    it('should emit key-generated event', async () => {
      const listener = vi.fn();
      manager.on('key-generated', listener);

      await manager.generateLocalKey();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'key-generated',
          participantId: 'local-user',
          generation: 0,
        })
      );
    });

    it('should emit key-rotated event on subsequent generations', async () => {
      await manager.generateLocalKey();

      const listener = vi.fn();
      manager.on('key-rotated', listener);

      await manager.generateLocalKey();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'key-rotated',
          participantId: 'local-user',
          generation: 1,
        })
      );
    });
  });

  describe('exportLocalKey', () => {
    it('should export the local key', async () => {
      await manager.generateLocalKey();
      const exported = await manager.exportLocalKey();

      expect(exported.participantId).toBe('local-user');
      expect(exported.generation).toBe(0);
      // exportKey returns Uint8Array, check byteLength
      expect(exported.keyData.byteLength).toBe(32); // AES-256
    });

    it('should throw if no local key generated', async () => {
      await expect(manager.exportLocalKey()).rejects.toThrow('No local key generated');
    });
  });

  describe('importRemoteKey', () => {
    let remoteKey: SerializedSenderKey;

    beforeEach(async () => {
      // Create a remote manager and export its key
      const remoteManager = new SenderKeyManager({ participantId: 'remote-user' });
      await remoteManager.generateLocalKey();
      remoteKey = await remoteManager.exportLocalKey();
    });

    it('should import a remote key', async () => {
      await manager.importRemoteKey(remoteKey);

      expect(manager.participants).toContain('remote-user');
    });

    it('should throw when importing own key', async () => {
      await manager.generateLocalKey();
      const ownKey = await manager.exportLocalKey();

      await expect(manager.importRemoteKey(ownKey)).rejects.toThrow(
        'Cannot import own key as remote key'
      );
    });

    it('should emit participant-added for new participants', async () => {
      const listener = vi.fn();
      manager.on('participant-added', listener);

      await manager.importRemoteKey(remoteKey);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'participant-added',
          participantId: 'remote-user',
        })
      );
    });

    it('should emit key-received for existing participants', async () => {
      await manager.importRemoteKey(remoteKey);

      const listener = vi.fn();
      manager.on('key-received', listener);

      // Import a new generation
      const remoteManager = new SenderKeyManager({ participantId: 'remote-user' });
      await remoteManager.generateLocalKey();
      await remoteManager.generateLocalKey();
      const newKey = await remoteManager.exportLocalKey();

      await manager.importRemoteKey(newKey);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'key-received',
          participantId: 'remote-user',
          generation: 1,
        })
      );
    });

    it('should maintain key history up to maxKeyHistory', async () => {
      const customManager = new SenderKeyManager({
        participantId: 'local',
        maxKeyHistory: 2,
      });

      // Import multiple generations
      for (let i = 0; i < 5; i++) {
        const remoteManager = new SenderKeyManager({ participantId: 'remote' });
        // Generate i+1 keys to get generation i
        for (let j = 0; j <= i; j++) {
          await remoteManager.generateLocalKey();
        }
        await customManager.importRemoteKey(await remoteManager.exportLocalKey());
      }

      // Should only have last 2 generations (3 and 4)
      expect(customManager.getDecryptionKey('remote', 0 as KeyGeneration)).toBeNull();
      expect(customManager.getDecryptionKey('remote', 1 as KeyGeneration)).toBeNull();
      expect(customManager.getDecryptionKey('remote', 2 as KeyGeneration)).toBeNull();
      expect(customManager.getDecryptionKey('remote', 3 as KeyGeneration)).not.toBeNull();
      expect(customManager.getDecryptionKey('remote', 4 as KeyGeneration)).not.toBeNull();
    });
  });

  describe('getEncryptionKey', () => {
    it('should return null if no local key', () => {
      expect(manager.getEncryptionKey()).toBeNull();
    });

    it('should return the local key', async () => {
      await manager.generateLocalKey();
      const key = manager.getEncryptionKey();

      expect(key).not.toBeNull();
      expect(key).toBe(manager.currentKey?.key);
    });
  });

  describe('getDecryptionKey', () => {
    it('should return local key for local participant', async () => {
      await manager.generateLocalKey();
      const key = manager.getDecryptionKey('local-user', 0 as KeyGeneration);

      expect(key).not.toBeNull();
    });

    it('should return null for unknown participant', () => {
      const key = manager.getDecryptionKey('unknown', 0 as KeyGeneration);
      expect(key).toBeNull();
    });

    it('should return null for wrong generation', async () => {
      await manager.generateLocalKey();
      const key = manager.getDecryptionKey('local-user', 99 as KeyGeneration);

      expect(key).toBeNull();
    });

    it('should return remote key for remote participant', async () => {
      const remoteManager = new SenderKeyManager({ participantId: 'remote' });
      await remoteManager.generateLocalKey();
      const remoteKey = await remoteManager.exportLocalKey();

      await manager.importRemoteKey(remoteKey);
      const key = manager.getDecryptionKey('remote', 0 as KeyGeneration);

      expect(key).not.toBeNull();
    });
  });

  describe('getGeneration', () => {
    it('should return null for unknown participant', () => {
      expect(manager.getGeneration('unknown')).toBeNull();
    });

    it('should return local generation', async () => {
      await manager.generateLocalKey();
      expect(manager.getGeneration('local-user')).toBe(0);

      await manager.generateLocalKey();
      expect(manager.getGeneration('local-user')).toBe(1);
    });

    it('should return remote generation', async () => {
      const remoteManager = new SenderKeyManager({ participantId: 'remote' });
      await remoteManager.generateLocalKey();
      await manager.importRemoteKey(await remoteManager.exportLocalKey());

      expect(manager.getGeneration('remote')).toBe(0);
    });
  });

  describe('removeParticipant', () => {
    it('should remove a participant', async () => {
      const remoteManager = new SenderKeyManager({ participantId: 'remote' });
      await remoteManager.generateLocalKey();
      await manager.importRemoteKey(await remoteManager.exportLocalKey());

      expect(manager.participants).toContain('remote');

      const removed = manager.removeParticipant('remote');

      expect(removed).toBe(true);
      expect(manager.participants).not.toContain('remote');
    });

    it('should throw when removing local participant', async () => {
      await manager.generateLocalKey();

      expect(() => manager.removeParticipant('local-user')).toThrow(
        'Cannot remove local participant'
      );
    });

    it('should return false for unknown participant', () => {
      expect(manager.removeParticipant('unknown')).toBe(false);
    });

    it('should emit participant-removed event', async () => {
      const remoteManager = new SenderKeyManager({ participantId: 'remote' });
      await remoteManager.generateLocalKey();
      await manager.importRemoteKey(await remoteManager.exportLocalKey());

      const listener = vi.fn();
      manager.on('participant-removed', listener);

      manager.removeParticipant('remote');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'participant-removed',
          participantId: 'remote',
        })
      );
    });
  });

  describe('shouldRatchet', () => {
    it('should return false initially', () => {
      expect(manager.shouldRatchet()).toBe(false);
    });

    it('should return true after ratchetInterval messages', async () => {
      const customManager = new SenderKeyManager({
        participantId: 'local',
        ratchetInterval: 3,
      });

      await customManager.generateLocalKey();

      customManager.getEncryptionKey();
      customManager.getEncryptionKey();
      expect(customManager.shouldRatchet()).toBe(false);

      customManager.getEncryptionKey();
      expect(customManager.shouldRatchet()).toBe(true);
    });

    it('should reset after resetRatchetCounter', async () => {
      const customManager = new SenderKeyManager({
        participantId: 'local',
        ratchetInterval: 2,
      });

      await customManager.generateLocalKey();

      customManager.getEncryptionKey();
      customManager.getEncryptionKey();
      expect(customManager.shouldRatchet()).toBe(true);

      customManager.resetRatchetCounter();
      expect(customManager.shouldRatchet()).toBe(false);
    });

    it('should return false if ratcheting disabled', async () => {
      const customManager = new SenderKeyManager({
        participantId: 'local',
        enableRatcheting: false,
        ratchetInterval: 1,
      });

      await customManager.generateLocalKey();
      customManager.getEncryptionKey();
      customManager.getEncryptionKey();

      expect(customManager.shouldRatchet()).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all keys and state', async () => {
      await manager.generateLocalKey();
      const remoteManager = new SenderKeyManager({ participantId: 'remote' });
      await remoteManager.generateLocalKey();
      await manager.importRemoteKey(await remoteManager.exportLocalKey());

      manager.clear();

      expect(manager.currentKey).toBeNull();
      expect(manager.participants).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      await manager.generateLocalKey();

      const remoteManager = new SenderKeyManager({ participantId: 'remote' });
      await remoteManager.generateLocalKey();
      await manager.importRemoteKey(await remoteManager.exportLocalKey());

      manager.getEncryptionKey();
      manager.getEncryptionKey();

      const stats = manager.getStats();

      expect(stats.participantCount).toBe(2);
      expect(stats.localGeneration).toBe(0);
      expect(stats.messageCount).toBe(2);
      expect(stats.remoteKeyCount).toBe(1);
    });
  });

  describe('event listeners', () => {
    it('should add and remove listeners', async () => {
      const listener = vi.fn();

      manager.on('key-generated', listener);
      await manager.generateLocalKey();
      expect(listener).toHaveBeenCalledTimes(1);

      manager.off('key-generated', listener);
      await manager.generateLocalKey();
      expect(listener).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it('should handle listener errors gracefully', async () => {
      const badListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const goodListener = vi.fn();

      manager.on('key-generated', badListener);
      manager.on('key-generated', goodListener);

      await manager.generateLocalKey();

      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });
  });
});
