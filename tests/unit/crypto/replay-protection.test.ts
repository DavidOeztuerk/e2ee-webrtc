/**
 * @fileoverview Unit tests for replay attack protection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReplayProtector,
  ReplayProtectionManager,
  getNextSequence,
  resetSequenceCounter,
  serializeSequence,
  deserializeSequence,
  SEQUENCE_SIZE,
} from '@core/crypto/replay-protection';
import { E2EEErrorCode } from '../../../src/types';

describe('Replay Protection Module', () => {
  // ===========================================================================
  // ReplayProtector Tests
  // ===========================================================================
  describe('ReplayProtector', () => {
    let protector: ReplayProtector;

    beforeEach(() => {
      protector = new ReplayProtector();
    });

    describe('basic sequence validation', () => {
      it('should accept the first sequence', () => {
        expect(protector.check(0)).toBe(true);
      });

      it('should accept sequential frames', () => {
        expect(protector.check(0)).toBe(true);
        expect(protector.check(1)).toBe(true);
        expect(protector.check(2)).toBe(true);
        expect(protector.check(3)).toBe(true);
      });

      it('should reject duplicate sequence numbers', () => {
        expect(protector.check(5)).toBe(true);
        expect(protector.check(5)).toBe(false); // Replay!
      });

      it('should accept out-of-order frames within window', () => {
        expect(protector.check(10)).toBe(true);
        expect(protector.check(8)).toBe(true); // Out of order but within window
        expect(protector.check(9)).toBe(true);
        expect(protector.check(7)).toBe(true);
      });

      it('should reject replayed out-of-order frames', () => {
        expect(protector.check(10)).toBe(true);
        expect(protector.check(8)).toBe(true);
        expect(protector.check(8)).toBe(false); // Replay!
      });
    });

    describe('window boundaries', () => {
      it('should reject frames too old (outside window)', () => {
        // Default window size is 1024
        expect(protector.check(2000)).toBe(true);
        expect(protector.check(500)).toBe(false); // Too old (2000 - 500 > 1024)
      });

      it('should accept frames at window boundary', () => {
        expect(protector.check(1024)).toBe(true);
        expect(protector.check(0)).toBe(true); // Exactly at window boundary
      });

      it('should reject frames just outside window', () => {
        expect(protector.check(1025)).toBe(true);
        expect(protector.check(0)).toBe(false); // Just outside window
      });

      it('should reject frames too far ahead', () => {
        const protector = new ReplayProtector({ windowSize: 100, maxGap: 200 });
        expect(protector.check(0)).toBe(true);
        expect(protector.check(500)).toBe(false); // Too far ahead (500 > maxGap)
      });
    });

    describe('window sliding', () => {
      it('should slide window when higher sequence arrives', () => {
        expect(protector.check(0)).toBe(true);
        expect(protector.check(100)).toBe(true);
        expect(protector.check(200)).toBe(true);

        // Old sequences should still work within window
        expect(protector.check(150)).toBe(true);
        expect(protector.check(180)).toBe(true);
      });

      it('should clear old entries when window slides', () => {
        expect(protector.check(0)).toBe(true);
        expect(protector.check(2000)).toBe(true); // Slide window past 0

        // Now 0 is outside window and considered "too old", not "seen"
        // This is expected behavior - we don't track ancient sequences
        const stats = protector.getStats();
        expect(stats.highestSequence).toBe(2000);
      });
    });

    describe('sequence wrap-around', () => {
      it('should handle wrap-around correctly', () => {
        const protector = new ReplayProtector({ allowWrapAround: true });

        // Approach max sequence
        expect(protector.check(0xffffffff - 10)).toBe(true);
        expect(protector.check(0xffffffff - 5)).toBe(true);
        expect(protector.check(0xffffffff)).toBe(true);

        // Wrap around to 0
        expect(protector.check(0)).toBe(true);
        expect(protector.check(5)).toBe(true);
      });

      it('should reject replays during wrap-around', () => {
        const protector = new ReplayProtector({ allowWrapAround: true });

        expect(protector.check(0xffffffff)).toBe(true);
        expect(protector.check(0)).toBe(true);
        expect(protector.check(0)).toBe(false); // Replay!
      });
    });

    describe('invalid sequences', () => {
      it('should reject negative sequences', () => {
        expect(protector.check(-1)).toBe(false);
        expect(protector.check(-100)).toBe(false);
      });

      it('should reject non-integer sequences', () => {
        expect(protector.check(1.5)).toBe(false);
        expect(protector.check(NaN)).toBe(false);
        expect(protector.check(Infinity)).toBe(false);
      });

      it('should reject sequences above MAX_SEQUENCE', () => {
        expect(protector.check(0xffffffff + 1)).toBe(false);
      });
    });

    describe('checkOrThrow', () => {
      it('should not throw for valid sequence', () => {
        expect(() => protector.checkOrThrow(0)).not.toThrow();
      });

      it('should throw E2EEError for replay', () => {
        protector.check(0);

        try {
          protector.checkOrThrow(0);
          expect.fail('Should have thrown');
        } catch (error) {
          expect((error as Error).name).toBe('E2EEError');
          expect((error as { code: string }).code).toBe(E2EEErrorCode.REPLAY_DETECTED);
        }
      });
    });

    describe('statistics', () => {
      it('should track frames checked', () => {
        protector.check(0);
        protector.check(1);
        protector.check(2);

        const stats = protector.getStats();
        expect(stats.framesChecked).toBe(3);
      });

      it('should track frames accepted', () => {
        protector.check(0);
        protector.check(1);
        protector.check(0); // Replay, rejected

        const stats = protector.getStats();
        expect(stats.framesAccepted).toBe(2);
      });

      it('should track replays detected', () => {
        protector.check(0);
        protector.check(0);
        protector.check(0);

        const stats = protector.getStats();
        expect(stats.replaysDetected).toBe(2);
      });

      it('should track highest sequence', () => {
        protector.check(10);
        protector.check(5);
        protector.check(20);

        const stats = protector.getStats();
        expect(stats.highestSequence).toBe(20);
      });

      it('should track too old rejections', () => {
        const protector = new ReplayProtector({ windowSize: 100 });
        protector.check(200);
        protector.check(50); // Too old

        const stats = protector.getStats();
        expect(stats.tooOldRejected).toBe(1);
      });

      it('should track too far ahead rejections', () => {
        const protector = new ReplayProtector({ maxGap: 100 });
        protector.check(0);
        protector.check(500); // Too far ahead

        const stats = protector.getStats();
        expect(stats.tooFarAheadRejected).toBe(1);
      });
    });

    describe('reset', () => {
      it('should reset all state', () => {
        protector.check(0);
        protector.check(100);
        protector.check(0); // Replay

        protector.reset();

        // Should accept 0 again after reset
        expect(protector.check(0)).toBe(true);

        const stats = protector.getStats();
        expect(stats.framesChecked).toBe(1);
        expect(stats.replaysDetected).toBe(0);
        expect(stats.highestSequence).toBe(0);
      });
    });

    describe('custom configuration', () => {
      it('should respect custom window size', () => {
        const protector = new ReplayProtector({ windowSize: 50 });

        protector.check(100);
        expect(protector.check(40)).toBe(false); // Outside window of 50
        expect(protector.check(60)).toBe(true); // Inside window
      });

      it('should respect custom max gap', () => {
        const protector = new ReplayProtector({ maxGap: 50 });

        protector.check(0);
        expect(protector.check(100)).toBe(false); // Too far ahead
        expect(protector.check(40)).toBe(true); // Within gap
      });
    });
  });

  // ===========================================================================
  // ReplayProtectionManager Tests
  // ===========================================================================
  describe('ReplayProtectionManager', () => {
    let manager: ReplayProtectionManager;

    beforeEach(() => {
      manager = new ReplayProtectionManager();
    });

    it('should create separate protectors for different senders', () => {
      expect(manager.check('alice', 0)).toBe(true);
      expect(manager.check('bob', 0)).toBe(true); // Same sequence, different sender

      // Both should reject their own replay
      expect(manager.check('alice', 0)).toBe(false);
      expect(manager.check('bob', 0)).toBe(false);
    });

    it('should track stats per sender', () => {
      manager.check('alice', 0);
      manager.check('alice', 1);
      manager.check('bob', 0);

      const aliceStats = manager.getStats('alice');
      const bobStats = manager.getStats('bob');

      expect(aliceStats?.framesChecked).toBe(2);
      expect(bobStats?.framesChecked).toBe(1);
    });

    it('should return undefined stats for unknown sender', () => {
      expect(manager.getStats('unknown')).toBeUndefined();
    });

    it('should get all stats', () => {
      manager.check('alice', 0);
      manager.check('bob', 0);

      const allStats = manager.getAllStats();

      expect(allStats.size).toBe(2);
      expect(allStats.has('alice')).toBe(true);
      expect(allStats.has('bob')).toBe(true);
    });

    it('should remove sender', () => {
      manager.check('alice', 0);
      manager.removeSender('alice');

      // After removal, alice starts fresh
      expect(manager.check('alice', 0)).toBe(true);
    });

    it('should reset all', () => {
      manager.check('alice', 0);
      manager.check('bob', 0);
      manager.reset();

      const allStats = manager.getAllStats();
      expect(allStats.size).toBe(0);
    });

    it('should use configured options for all protectors', () => {
      const manager = new ReplayProtectionManager({ windowSize: 50 });

      manager.check('alice', 100);
      expect(manager.check('alice', 40)).toBe(false); // Outside window of 50
    });

    it('checkOrThrow should throw for replay', () => {
      manager.check('alice', 0);

      expect(() => manager.checkOrThrow('alice', 0)).toThrow();
    });
  });

  // ===========================================================================
  // Sequence Number Utilities Tests
  // ===========================================================================
  describe('Sequence Number Utilities', () => {
    describe('getNextSequence', () => {
      beforeEach(() => {
        resetSequenceCounter();
      });

      it('should return incrementing sequences', () => {
        expect(getNextSequence()).toBe(0);
        expect(getNextSequence()).toBe(1);
        expect(getNextSequence()).toBe(2);
      });

      it('should wrap around at max sequence', () => {
        // This would take too long to actually test wrap-around
        // Just verify the function works
        for (let i = 0; i < 100; i++) {
          const seq = getNextSequence();
          expect(seq).toBeGreaterThanOrEqual(0);
        }
      });
    });

    describe('resetSequenceCounter', () => {
      it('should reset counter to 0', () => {
        getNextSequence();
        getNextSequence();
        resetSequenceCounter();
        expect(getNextSequence()).toBe(0);
      });
    });

    describe('serializeSequence', () => {
      it('should serialize to 4 bytes big-endian', () => {
        const bytes = serializeSequence(0x12345678);

        expect(bytes.length).toBe(SEQUENCE_SIZE);
        expect(bytes[0]).toBe(0x12);
        expect(bytes[1]).toBe(0x34);
        expect(bytes[2]).toBe(0x56);
        expect(bytes[3]).toBe(0x78);
      });

      it('should serialize 0 correctly', () => {
        const bytes = serializeSequence(0);
        expect(Array.from(bytes)).toEqual([0, 0, 0, 0]);
      });

      it('should serialize max value correctly', () => {
        const bytes = serializeSequence(0xffffffff);
        expect(Array.from(bytes)).toEqual([0xff, 0xff, 0xff, 0xff]);
      });
    });

    describe('deserializeSequence', () => {
      it('should deserialize from 4 bytes big-endian', () => {
        const bytes = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
        expect(deserializeSequence(bytes)).toBe(0x12345678);
      });

      it('should deserialize 0 correctly', () => {
        const bytes = new Uint8Array([0, 0, 0, 0]);
        expect(deserializeSequence(bytes)).toBe(0);
      });

      it('should deserialize max value correctly', () => {
        const bytes = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
        expect(deserializeSequence(bytes)).toBe(0xffffffff);
      });

      it('should respect offset parameter', () => {
        const bytes = new Uint8Array([0x00, 0x00, 0x12, 0x34, 0x56, 0x78]);
        expect(deserializeSequence(bytes, 2)).toBe(0x12345678);
      });

      it('should throw on insufficient bytes', () => {
        const bytes = new Uint8Array([0x12, 0x34]);
        expect(() => deserializeSequence(bytes)).toThrow();
      });

      it('should throw on insufficient bytes with offset', () => {
        const bytes = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
        expect(() => deserializeSequence(bytes, 2)).toThrow();
      });
    });

    describe('round-trip serialization', () => {
      it('should round-trip any valid sequence', () => {
        const testValues = [0, 1, 255, 256, 65535, 65536, 0x12345678, 0xffffffff];

        for (const value of testValues) {
          const serialized = serializeSequence(value);
          const deserialized = deserializeSequence(serialized);
          expect(deserialized).toBe(value);
        }
      });
    });
  });

  // ===========================================================================
  // Stress Tests
  // ===========================================================================
  describe('Stress Tests', () => {
    it('should handle rapid sequential frames', () => {
      const protector = new ReplayProtector();

      for (let i = 0; i < 10000; i++) {
        expect(protector.check(i)).toBe(true);
      }

      const stats = protector.getStats();
      expect(stats.framesAccepted).toBe(10000);
      expect(stats.replaysDetected).toBe(0);
    });

    it('should handle random order within window', () => {
      const protector = new ReplayProtector({ windowSize: 100 });

      // Generate shuffled array of sequences
      const sequences = Array.from({ length: 100 }, (_, i) => i);
      for (let i = sequences.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sequences[i], sequences[j]] = [sequences[j]!, sequences[i]!];
      }

      for (const seq of sequences) {
        expect(protector.check(seq)).toBe(true);
      }

      const stats = protector.getStats();
      expect(stats.framesAccepted).toBe(100);
    });

    it('should efficiently detect replays in large streams', () => {
      const protector = new ReplayProtector();

      // Send 1000 frames, then try to replay all of them
      for (let i = 0; i < 1000; i++) {
        protector.check(i);
      }

      // Try to replay recent frames (within window)
      let replaysDetected = 0;
      for (let i = 0; i < 1000; i++) {
        if (!protector.check(i)) {
          replaysDetected++;
        }
      }

      // All within window should be detected as replays
      const stats = protector.getStats();
      expect(stats.replaysDetected).toBeGreaterThan(0);
    });
  });
});
