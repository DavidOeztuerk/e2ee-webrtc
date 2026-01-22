/**
 * Tests for ParticipantManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ParticipantManager } from '../../../src/sfu/participant-manager';
import type { KeyGeneration } from '../../../src/types';

describe('ParticipantManager', () => {
  let manager: ParticipantManager;

  beforeEach(() => {
    manager = new ParticipantManager({
      localParticipantId: 'local-user',
    });
  });

  describe('constructor', () => {
    it('should create manager with default config', () => {
      expect(manager.localParticipantId).toBe('local-user');
      expect(manager.count).toBe(0);
      expect(manager.all).toEqual([]);
    });

    it('should use provided config values', () => {
      const customManager = new ParticipantManager({
        localParticipantId: 'custom',
        maxParticipants: 10,
        inactivityTimeout: 5000,
      });

      expect(customManager.localParticipantId).toBe('custom');
    });
  });

  describe('addParticipant', () => {
    it('should add a new participant with defaults', () => {
      const participant = manager.addParticipant('user1');

      expect(participant.id).toBe('user1');
      expect(participant.role).toBe('participant');
      expect(participant.keyReceived).toBe(false);
      expect(participant.connectionState).toBe('connecting');
    });

    it('should add a participant with custom options', () => {
      const participant = manager.addParticipant('user1', {
        displayName: 'John Doe',
        role: 'host',
        audioEnabled: true,
        videoEnabled: true,
      });

      expect(participant.displayName).toBe('John Doe');
      expect(participant.role).toBe('host');
      expect(participant.audioEnabled).toBe(true);
      expect(participant.videoEnabled).toBe(true);
    });

    it('should update existing participant', () => {
      manager.addParticipant('user1', { displayName: 'Original' });
      const updated = manager.addParticipant('user1', { displayName: 'Updated' });

      expect(updated.displayName).toBe('Updated');
      expect(manager.count).toBe(1);
    });

    it('should emit participant-joined for new participants', () => {
      const listener = vi.fn();
      manager.on('participant-joined', listener);

      manager.addParticipant('user1');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'participant-joined',
          participant: expect.objectContaining({ id: 'user1' }),
        })
      );
    });

    it('should emit participant-updated for existing participants', () => {
      manager.addParticipant('user1');

      const listener = vi.fn();
      manager.on('participant-updated', listener);

      manager.addParticipant('user1', { displayName: 'New Name' });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'participant-updated',
          participant: expect.objectContaining({ displayName: 'New Name' }),
        })
      );
    });

    it('should throw when room is at capacity', () => {
      const smallManager = new ParticipantManager({
        localParticipantId: 'local',
        maxParticipants: 2,
      });

      smallManager.addParticipant('user1');
      smallManager.addParticipant('user2');

      expect(() => smallManager.addParticipant('user3')).toThrow('Room is at capacity (2)');
    });
  });

  describe('getParticipant', () => {
    it('should return participant by ID', () => {
      manager.addParticipant('user1', { displayName: 'John' });

      const participant = manager.getParticipant('user1');

      expect(participant?.displayName).toBe('John');
    });

    it('should return undefined for unknown participant', () => {
      expect(manager.getParticipant('unknown')).toBeUndefined();
    });
  });

  describe('getLocalParticipant', () => {
    it('should return local participant', () => {
      manager.addParticipant('local-user', { displayName: 'Me' });

      const local = manager.getLocalParticipant();

      expect(local?.displayName).toBe('Me');
    });

    it('should return undefined if local not added', () => {
      expect(manager.getLocalParticipant()).toBeUndefined();
    });
  });

  describe('updateKeyState', () => {
    it('should update key received state', () => {
      manager.addParticipant('user1');
      manager.updateKeyState('user1', 5 as KeyGeneration);

      const participant = manager.getParticipant('user1');
      expect(participant?.keyReceived).toBe(true);
      expect(participant?.keyGeneration).toBe(5);
    });

    it('should do nothing for unknown participant', () => {
      expect(() => manager.updateKeyState('unknown', 0 as KeyGeneration)).not.toThrow();
    });

    it('should emit participant-updated', () => {
      manager.addParticipant('user1');

      const listener = vi.fn();
      manager.on('participant-updated', listener);

      manager.updateKeyState('user1', 0 as KeyGeneration);

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('updateConnectionState', () => {
    it('should update connection state', () => {
      manager.addParticipant('user1');
      manager.updateConnectionState('user1', 'connected');

      expect(manager.getParticipant('user1')?.connectionState).toBe('connected');
    });

    it('should emit connection-state-changed', () => {
      manager.addParticipant('user1');

      const listener = vi.fn();
      manager.on('connection-state-changed', listener);

      manager.updateConnectionState('user1', 'disconnected');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'connection-state-changed',
          previousState: { connectionState: 'connecting' },
        })
      );
    });
  });

  describe('updateRole', () => {
    it('should update participant role', () => {
      manager.addParticipant('user1');
      manager.updateRole('user1', 'host');

      expect(manager.getParticipant('user1')?.role).toBe('host');
    });

    it('should emit role-changed', () => {
      manager.addParticipant('user1');

      const listener = vi.fn();
      manager.on('role-changed', listener);

      manager.updateRole('user1', 'moderator');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'role-changed',
          previousState: { role: 'participant' },
        })
      );
    });
  });

  describe('updateMediaState', () => {
    it('should update audio state', () => {
      manager.addParticipant('user1');
      manager.updateMediaState('user1', true, undefined);

      expect(manager.getParticipant('user1')?.audioEnabled).toBe(true);
    });

    it('should update video state', () => {
      manager.addParticipant('user1');
      manager.updateMediaState('user1', undefined, true);

      expect(manager.getParticipant('user1')?.videoEnabled).toBe(true);
    });

    it('should update both states', () => {
      manager.addParticipant('user1');
      manager.updateMediaState('user1', true, true);

      const participant = manager.getParticipant('user1');
      expect(participant?.audioEnabled).toBe(true);
      expect(participant?.videoEnabled).toBe(true);
    });
  });

  describe('removeParticipant', () => {
    it('should remove a participant', () => {
      manager.addParticipant('user1');
      const removed = manager.removeParticipant('user1');

      expect(removed).toBe(true);
      expect(manager.count).toBe(0);
    });

    it('should return false for unknown participant', () => {
      expect(manager.removeParticipant('unknown')).toBe(false);
    });

    it('should emit participant-left', () => {
      manager.addParticipant('user1');

      const listener = vi.fn();
      manager.on('participant-left', listener);

      manager.removeParticipant('user1');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'participant-left',
          participant: expect.objectContaining({ id: 'user1' }),
        })
      );
    });
  });

  describe('getEncryptionReadyParticipants', () => {
    it('should return participants with keys and connected', () => {
      manager.addParticipant('user1');
      manager.addParticipant('user2');
      manager.addParticipant('user3');

      manager.updateKeyState('user1', 0 as KeyGeneration);
      manager.updateConnectionState('user1', 'connected');

      manager.updateKeyState('user2', 0 as KeyGeneration);
      manager.updateConnectionState('user2', 'connected');

      // user3 has no key

      const ready = manager.getEncryptionReadyParticipants();

      expect(ready.length).toBe(2);
      expect(ready.map((p) => p.id)).toContain('user1');
      expect(ready.map((p) => p.id)).toContain('user2');
    });
  });

  describe('getParticipantsAwaitingKeys', () => {
    it('should return connected participants without keys', () => {
      manager.addParticipant('user1');
      manager.addParticipant('user2');

      manager.updateConnectionState('user1', 'connected');
      manager.updateConnectionState('user2', 'connected');
      manager.updateKeyState('user1', 0 as KeyGeneration);

      const awaiting = manager.getParticipantsAwaitingKeys();

      expect(awaiting.length).toBe(1);
      expect(awaiting[0].id).toBe('user2');
    });
  });

  describe('allParticipantsReady', () => {
    it('should return true when all connected have keys', () => {
      manager.addParticipant('user1');
      manager.addParticipant('user2');

      manager.updateConnectionState('user1', 'connected');
      manager.updateKeyState('user1', 0 as KeyGeneration);

      manager.updateConnectionState('user2', 'connected');
      manager.updateKeyState('user2', 0 as KeyGeneration);

      expect(manager.allParticipantsReady()).toBe(true);
    });

    it('should return true for disconnected without keys', () => {
      manager.addParticipant('user1');
      manager.updateConnectionState('user1', 'disconnected');

      expect(manager.allParticipantsReady()).toBe(true);
    });

    it('should return false when connected without keys', () => {
      manager.addParticipant('user1');
      manager.updateConnectionState('user1', 'connected');

      expect(manager.allParticipantsReady()).toBe(false);
    });
  });

  describe('getInactiveParticipants', () => {
    it('should return inactive participants', () => {
      const shortTimeoutManager = new ParticipantManager({
        localParticipantId: 'local',
        inactivityTimeout: 10, // 10ms
      });

      shortTimeoutManager.addParticipant('user1');

      // Wait for timeout
      vi.useFakeTimers();
      vi.advanceTimersByTime(20);

      const inactive = shortTimeoutManager.getInactiveParticipants();

      expect(inactive.length).toBe(1);
      expect(inactive[0].id).toBe('user1');

      vi.useRealTimers();
    });
  });

  describe('pruneInactive', () => {
    it('should remove inactive participants', () => {
      const shortTimeoutManager = new ParticipantManager({
        localParticipantId: 'local',
        inactivityTimeout: 10,
      });

      shortTimeoutManager.addParticipant('user1');
      shortTimeoutManager.addParticipant('local'); // Local participant

      vi.useFakeTimers();
      vi.advanceTimersByTime(20);

      const pruned = shortTimeoutManager.pruneInactive();

      expect(pruned.length).toBe(2); // Both inactive
      expect(shortTimeoutManager.count).toBe(1); // Only local remains (not pruned)
      expect(shortTimeoutManager.getParticipant('local')).toBeDefined();

      vi.useRealTimers();
    });
  });

  describe('isFull', () => {
    it('should return true when at capacity', () => {
      const smallManager = new ParticipantManager({
        localParticipantId: 'local',
        maxParticipants: 2,
      });

      expect(smallManager.isFull).toBe(false);

      smallManager.addParticipant('user1');
      expect(smallManager.isFull).toBe(false);

      smallManager.addParticipant('user2');
      expect(smallManager.isFull).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all participants', () => {
      manager.addParticipant('user1');
      manager.addParticipant('user2');

      manager.clear();

      expect(manager.count).toBe(0);
      expect(manager.all).toEqual([]);
    });
  });

  describe('event listeners', () => {
    it('should add and remove listeners', () => {
      const listener = vi.fn();

      manager.on('participant-joined', listener);
      manager.addParticipant('user1');
      expect(listener).toHaveBeenCalledTimes(1);

      manager.off('participant-joined', listener);
      manager.addParticipant('user2');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should handle listener errors gracefully', () => {
      const badListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const goodListener = vi.fn();

      manager.on('participant-joined', badListener);
      manager.on('participant-joined', goodListener);

      manager.addParticipant('user1');

      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });
  });
});
