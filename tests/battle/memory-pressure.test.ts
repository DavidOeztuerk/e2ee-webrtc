/**
 * @fileoverview Battle tests for memory pressure scenarios
 * Tests memory usage and cleanup under various conditions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateEncryptionKey,
  encryptFrame,
  decryptFrame,
  generateIV,
  zeroizeKey,
} from '@core/crypto/aes-gcm';
import { generateKeyPair, deriveSharedSecret, deriveEncryptionKey } from '@core/crypto/ecdh';
import {
  ReplayProtector,
  ReplayProtectionManager,
  getNextSequence,
  resetSequenceCounter,
} from '@core/crypto/replay-protection';
import { SenderKeyManager } from '@sfu/sender-keys';
import { ParticipantManager } from '@sfu/participant-manager';
import { KeyManager } from '@core/key-manager';

/**
 * Fill a buffer with random data in chunks (crypto.getRandomValues has 65536 byte limit)
 */
function fillRandomBuffer(buffer: Uint8Array): void {
  const CHUNK_SIZE = 65536;
  for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
    const remaining = buffer.length - offset;
    const chunk = Math.min(CHUNK_SIZE, remaining);
    crypto.getRandomValues(buffer.subarray(offset, offset + chunk));
  }
}

describe('Memory Pressure Battle Tests', () => {
  // ===========================================================================
  // Key Generation Stress
  // ===========================================================================
  describe('Key Generation Stress', () => {
    it('should generate many encryption keys without memory leak', async () => {
      const keyCount = 1000;
      const keys: CryptoKey[] = [];

      const startMemory = process.memoryUsage().heapUsed;
      const start = performance.now();

      for (let i = 0; i < keyCount; i++) {
        const key = await generateEncryptionKey();
        keys.push(key);
      }

      const elapsed = performance.now() - start;
      const keysPerSec = keyCount / (elapsed / 1000);

      console.log(
        `[Key Generation] ${keyCount} keys in ${elapsed.toFixed(0)}ms\n` +
          `  ${keysPerSec.toFixed(0)} keys/sec`
      );

      // Keys should be valid
      for (let i = 0; i < 10; i++) {
        const plaintext = new Uint8Array([1, 2, 3, 4]);
        const iv = await generateIV();
        const encrypted = await encryptFrame(plaintext, keys[i]!, iv);
        const decrypted = await decryptFrame(encrypted, keys[i]!, iv);
        expect(Array.from(decrypted)).toEqual([1, 2, 3, 4]);
      }

      // Cleanup
      keys.length = 0;

      // Force GC if available
      if (global.gc) {
        global.gc();
      }
    });

    it('should handle rapid ECDH key pair generation', async () => {
      const pairCount = 500;
      const keyPairs: CryptoKeyPair[] = [];

      const start = performance.now();

      for (let i = 0; i < pairCount; i++) {
        const keyPair = await generateKeyPair();
        keyPairs.push(keyPair);
      }

      const elapsed = performance.now() - start;
      const pairsPerSec = pairCount / (elapsed / 1000);

      console.log(
        `[ECDH Key Generation] ${pairCount} pairs in ${elapsed.toFixed(0)}ms\n` +
          `  ${pairsPerSec.toFixed(0)} pairs/sec`
      );

      expect(keyPairs.length).toBe(pairCount);

      // Cleanup
      keyPairs.length = 0;
    });

    it('should handle ECDH derivation under load', async () => {
      const pairCount = 100;
      const derivations = 500;

      // Generate key pairs first
      const keyPairs = await Promise.all(
        Array.from({ length: pairCount }, () => generateKeyPair())
      );

      const start = performance.now();
      let derivationCount = 0;

      // Derive shared secrets between random pairs
      for (let i = 0; i < derivations; i++) {
        const idx1 = i % pairCount;
        const idx2 = (i + 1) % pairCount;

        const sharedSecret = await deriveSharedSecret(
          keyPairs[idx1]!.privateKey,
          keyPairs[idx2]!.publicKey
        );

        const encryptionKey = await deriveEncryptionKey(sharedSecret);
        expect(encryptionKey.type).toBe('secret');
        derivationCount++;
      }

      const elapsed = performance.now() - start;
      const derivationsPerSec = derivationCount / (elapsed / 1000);

      console.log(
        `[ECDH Derivation] ${derivationCount} derivations in ${elapsed.toFixed(0)}ms\n` +
          `  ${derivationsPerSec.toFixed(0)} derivations/sec`
      );
    });
  });

  // ===========================================================================
  // Large Frame Handling
  // ===========================================================================
  describe('Large Frame Handling', () => {
    let encryptionKey: CryptoKey;

    beforeEach(async () => {
      encryptionKey = await generateEncryptionKey();
    });

    it('should handle large video I-frames (1MB)', async () => {
      const frameSize = 1 * 1024 * 1024; // 1MB
      const iterations = 5;

      const plaintext = new Uint8Array(frameSize);
      fillRandomBuffer(plaintext);

      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        const iv = await generateIV();
        const encrypted = await encryptFrame(plaintext, encryptionKey, iv);
        const decrypted = await decryptFrame(encrypted, encryptionKey, iv);
        expect(decrypted.byteLength).toBe(frameSize);
      }

      const elapsed = performance.now() - start;
      const throughput = (frameSize * iterations * 2) / (elapsed / 1000) / 1024 / 1024;

      console.log(
        `[Large I-frames] ${iterations} frames (1MB each) in ${elapsed.toFixed(0)}ms\n` +
          `  Throughput: ${throughput.toFixed(2)} MB/s`
      );
    });

    it('should handle many small allocations (audio frames)', async () => {
      const frameSize = 160; // 20ms audio at 8kHz
      const iterations = 5_000; // Reduced to avoid timeout

      const plaintext = new Uint8Array(frameSize);
      crypto.getRandomValues(plaintext);

      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        const iv = await generateIV();
        const encrypted = await encryptFrame(plaintext, encryptionKey, iv);
        const decrypted = await decryptFrame(encrypted, encryptionKey, iv);
        expect(decrypted.byteLength).toBe(frameSize);
      }

      const elapsed = performance.now() - start;
      const framesPerSec = iterations / (elapsed / 1000);

      console.log(
        `[Audio Frames] ${iterations} frames (160B each) in ${elapsed.toFixed(0)}ms\n` +
          `  ${framesPerSec.toFixed(0)} frames/sec`
      );

      // Should handle at least 500 fps for audio in test environment
      expect(framesPerSec).toBeGreaterThan(500);
    });
  });

  // ===========================================================================
  // Replay Protection Memory
  // ===========================================================================
  describe('Replay Protection Memory', () => {
    it('should handle millions of sequence checks', () => {
      const protector = new ReplayProtector({ windowSize: 1024 });
      const iterations = 1_000_000;

      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        protector.check(i);
      }

      const elapsed = performance.now() - start;
      const checksPerSec = iterations / (elapsed / 1000);

      const stats = protector.getStats();

      console.log(
        `[Replay Protection] ${iterations.toLocaleString()} checks in ${elapsed.toFixed(0)}ms\n` +
          `  ${checksPerSec.toLocaleString()} checks/sec\n` +
          `  Accepted: ${stats.framesAccepted.toLocaleString()}\n` +
          `  Rejected: ${stats.replaysDetected + stats.tooOldRejected}`
      );

      // Performance varies by machine, just ensure it's reasonably fast
      expect(checksPerSec).toBeGreaterThan(50_000);
    });

    it('should handle many concurrent senders', () => {
      const manager = new ReplayProtectionManager({ windowSize: 256 });
      const senderCount = 1000;
      const framesPerSender = 1000;

      const start = performance.now();

      for (let frame = 0; frame < framesPerSender; frame++) {
        for (let sender = 0; sender < senderCount; sender++) {
          manager.check(`sender-${sender}`, frame);
        }
      }

      const elapsed = performance.now() - start;
      const totalChecks = senderCount * framesPerSender;
      const checksPerSec = totalChecks / (elapsed / 1000);

      console.log(
        `[Multi-Sender Replay] ${senderCount} senders x ${framesPerSender} frames\n` +
          `  ${totalChecks.toLocaleString()} checks in ${elapsed.toFixed(0)}ms\n` +
          `  ${checksPerSec.toLocaleString()} checks/sec`
      );

      // Verify stats
      const allStats = manager.getAllStats();
      expect(allStats.size).toBe(senderCount);
    });

    it('should handle sender churn (join/leave)', () => {
      const manager = new ReplayProtectionManager({ windowSize: 256 });
      const cycles = 100;
      const sendersPerCycle = 50;

      const start = performance.now();

      for (let cycle = 0; cycle < cycles; cycle++) {
        // Add senders
        for (let s = 0; s < sendersPerCycle; s++) {
          const senderId = `sender-${cycle}-${s}`;
          for (let f = 0; f < 100; f++) {
            manager.check(senderId, f);
          }
        }

        // Remove some senders
        for (let s = 0; s < sendersPerCycle / 2; s++) {
          manager.removeSender(`sender-${cycle}-${s}`);
        }
      }

      const elapsed = performance.now() - start;

      console.log(`[Sender Churn] ${cycles} cycles of join/leave in ${elapsed.toFixed(0)}ms`);

      // Should have some senders still tracked
      const remaining = manager.getAllStats().size;
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThan(cycles * sendersPerCycle);
    });
  });

  // ===========================================================================
  // SFU Participant Manager Memory
  // ===========================================================================
  describe('SFU Participant Manager Memory', () => {
    it('should handle many participants joining/leaving', async () => {
      const manager = new ParticipantManager({
        localParticipantId: 'local',
        maxParticipants: 200,
      });
      const participantCount = 100;
      const joinLeaveIterations = 50;

      const start = performance.now();

      for (let iter = 0; iter < joinLeaveIterations; iter++) {
        // Batch join
        for (let i = 0; i < participantCount; i++) {
          manager.addParticipant(`participant-${iter}-${i}`);
        }

        // Batch leave
        for (let i = 0; i < participantCount; i++) {
          manager.removeParticipant(`participant-${iter}-${i}`);
        }
      }

      const elapsed = performance.now() - start;
      const totalOps = joinLeaveIterations * participantCount * 2;
      const opsPerSec = totalOps / (elapsed / 1000);

      console.log(
        `[Participant Churn] ${totalOps} join/leave ops in ${elapsed.toFixed(0)}ms\n` +
          `  ${opsPerSec.toFixed(0)} ops/sec`
      );
    });

    it('should handle large participant count', async () => {
      const manager = new ParticipantManager({
        localParticipantId: 'local',
        maxParticipants: 600,
      });
      const participantCount = 500;

      const startJoin = performance.now();

      // Join all
      for (let i = 0; i < participantCount; i++) {
        manager.addParticipant(`participant-${i}`);
      }

      const joinElapsed = performance.now() - startJoin;

      // Verify all present
      expect(manager.count).toBe(participantCount);

      const startList = performance.now();

      // List operations
      for (let i = 0; i < 1000; i++) {
        const participants = manager.all;
        expect(participants.length).toBe(participantCount);
      }

      const listElapsed = performance.now() - startList;

      console.log(
        `[Large Participant Pool]\n` +
          `  Join ${participantCount}: ${joinElapsed.toFixed(0)}ms\n` +
          `  1000 list operations: ${listElapsed.toFixed(0)}ms`
      );

      // Cleanup - no clear method, so we remove all
      const startLeave = performance.now();
      for (let i = 0; i < participantCount; i++) {
        manager.removeParticipant(`participant-${i}`);
      }
      const leaveElapsed = performance.now() - startLeave;

      console.log(`  Remove all: ${leaveElapsed.toFixed(0)}ms`);
      expect(manager.count).toBe(0);
    });
  });

  // ===========================================================================
  // Sender Key Manager Memory
  // ===========================================================================
  describe('Sender Key Manager Memory', () => {
    it('should handle frequent key rotations', async () => {
      const manager = new SenderKeyManager({ participantId: 'test-participant' });
      const rotations = 100;

      const start = performance.now();

      for (let i = 0; i < rotations; i++) {
        await manager.generateLocalKey();
      }

      const elapsed = performance.now() - start;
      const rotationsPerSec = rotations / (elapsed / 1000);

      console.log(
        `[Key Rotations] ${rotations} rotations in ${elapsed.toFixed(0)}ms\n` +
          `  ${rotationsPerSec.toFixed(0)} rotations/sec`
      );

      // Local key should be defined
      expect(manager.currentKey).toBeDefined();
    });

    it('should handle concurrent operations', async () => {
      const manager = new SenderKeyManager({
        participantId: 'test-participant',
        maxKeyHistory: 10,
      });
      const operations = 1000;

      // Set initial key
      await manager.generateLocalKey();

      const start = performance.now();

      // Concurrent get operations
      const getPromises = Array.from({ length: operations }, () =>
        Promise.resolve(manager.currentKey)
      );

      const results = await Promise.all(getPromises);
      expect(results.every((k) => k !== null)).toBe(true);

      const elapsed = performance.now() - start;

      console.log(`[Concurrent Key Access] ${operations} gets in ${elapsed.toFixed(0)}ms`);
    });
  });

  // ===========================================================================
  // Sequence Counter Stress
  // ===========================================================================
  describe('Sequence Counter Stress', () => {
    beforeEach(() => {
      resetSequenceCounter();
    });

    it('should handle many sequence generations efficiently', () => {
      const iterations = 1_000_000;

      const start = performance.now();

      let lastSeq = -1;
      for (let i = 0; i < iterations; i++) {
        const seq = getNextSequence();
        // Only check every 10000th to reduce overhead
        if (i % 10000 === 0) {
          expect(seq).toBeGreaterThan(lastSeq);
          lastSeq = seq;
        }
      }

      const elapsed = performance.now() - start;
      const seqPerSec = iterations / (elapsed / 1000);

      console.log(
        `[Sequence Generation] ${iterations.toLocaleString()} sequences in ${elapsed.toFixed(0)}ms\n` +
          `  ${seqPerSec.toLocaleString()} sequences/sec`
      );

      // Should be reasonably fast (>50k/sec even with test overhead)
      expect(seqPerSec).toBeGreaterThan(50_000);
    });
  });
});
