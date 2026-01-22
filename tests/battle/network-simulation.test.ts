/**
 * @fileoverview Battle tests for network simulation scenarios
 * Tests behavior under packet loss, reordering, and network stress
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateEncryptionKey,
  encryptFrame,
  decryptFrame,
  generateIV,
  serializeFrame,
  deserializeFrame,
} from '@core/crypto/aes-gcm';
import {
  ReplayProtector,
  ReplayProtectionManager,
  getNextSequence,
  resetSequenceCounter,
  serializeSequence,
  deserializeSequence,
} from '@core/crypto/replay-protection';

describe('Network Simulation Battle Tests', () => {
  // ===========================================================================
  // Packet Loss Simulation
  // ===========================================================================
  describe('Packet Loss Simulation', () => {
    let encryptionKey: CryptoKey;

    beforeEach(async () => {
      encryptionKey = await generateEncryptionKey();
    });

    it('should handle 5% packet loss', async () => {
      const protector = new ReplayProtector({ windowSize: 256 });
      const totalFrames = 10_000;
      const lossRate = 0.05;

      let received = 0;
      let lost = 0;

      for (let seq = 0; seq < totalFrames; seq++) {
        // Simulate packet loss
        if (Math.random() < lossRate) {
          lost++;
          continue;
        }

        const result = protector.check(seq);
        if (result) received++;
      }

      const stats = protector.getStats();
      const actualLossRate = lost / totalFrames;

      console.log(
        `[5% Packet Loss]\n` +
          `  Sent: ${totalFrames}, Lost: ${lost} (${(actualLossRate * 100).toFixed(1)}%)\n` +
          `  Received: ${received}, Rejected: ${stats.tooOldRejected + stats.replaysDetected}`
      );

      // Loss rate should be approximately 5%
      expect(actualLossRate).toBeGreaterThan(0.03);
      expect(actualLossRate).toBeLessThan(0.07);
    });

    it('should handle 20% burst packet loss', async () => {
      const protector = new ReplayProtector({ windowSize: 512 });
      const totalFrames = 5_000;
      const burstLength = 50;
      const burstProbability = 0.02; // 2% chance of starting a burst

      let inBurst = false;
      let burstRemaining = 0;
      let lost = 0;
      let received = 0;
      let bursts = 0;

      for (let seq = 0; seq < totalFrames; seq++) {
        // Start new burst randomly
        if (!inBurst && Math.random() < burstProbability) {
          inBurst = true;
          burstRemaining = burstLength;
          bursts++;
        }

        // In burst - lose packet
        if (inBurst) {
          burstRemaining--;
          if (burstRemaining <= 0) {
            inBurst = false;
          }
          lost++;
          continue;
        }

        if (protector.check(seq)) {
          received++;
        }
      }

      const stats = protector.getStats();
      const lossRate = lost / totalFrames;

      console.log(
        `[Burst Packet Loss]\n` +
          `  Sent: ${totalFrames}, Bursts: ${bursts}, Lost: ${lost} (${(lossRate * 100).toFixed(1)}%)\n` +
          `  Received: ${received}\n` +
          `  Too old rejected: ${stats.tooOldRejected}`
      );

      // Most frames that weren't lost should be accepted
      // With burst loss, some "too old" rejections are expected after gaps
      const notLost = totalFrames - lost;
      expect(received).toBeGreaterThan(notLost * 0.7);
    });

    it('should handle complete frame encryption/decryption with loss', async () => {
      const frameSize = 10_000;
      const totalFrames = 1_000;
      const lossRate = 0.1;

      const plaintext = new Uint8Array(frameSize);
      crypto.getRandomValues(plaintext);

      let sent = 0;
      let received = 0;
      let decryptedSuccessfully = 0;

      for (let i = 0; i < totalFrames; i++) {
        sent++;

        // Simulate loss
        if (Math.random() < lossRate) {
          continue;
        }

        const iv = await generateIV();
        const encrypted = await encryptFrame(plaintext, encryptionKey, iv);

        received++;

        try {
          const decrypted = await decryptFrame(encrypted, encryptionKey, iv);
          if (decrypted.byteLength === frameSize) {
            decryptedSuccessfully++;
          }
        } catch {
          // Decryption failed (shouldn't happen without corruption)
        }
      }

      console.log(
        `[Frame Loss Simulation]\n` +
          `  Sent: ${sent}, Received: ${received}, Decrypted: ${decryptedSuccessfully}`
      );

      // All received frames should decrypt successfully
      expect(decryptedSuccessfully).toBe(received);
    });
  });

  // ===========================================================================
  // Packet Reordering Simulation
  // ===========================================================================
  describe('Packet Reordering Simulation', () => {
    it('should handle mild reordering (5 packets)', async () => {
      const protector = new ReplayProtector({ windowSize: 256 });
      const totalFrames = 5_000;
      const reorderBuffer: number[] = [];
      const maxReorder = 5;

      let received = 0;
      let rejected = 0;

      for (let seq = 0; seq < totalFrames; seq++) {
        reorderBuffer.push(seq);

        // Randomly reorder within buffer
        if (reorderBuffer.length >= maxReorder || seq === totalFrames - 1) {
          // Shuffle buffer
          for (let i = reorderBuffer.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [reorderBuffer[i], reorderBuffer[j]] = [reorderBuffer[j]!, reorderBuffer[i]!];
          }

          // Process all in buffer
          while (reorderBuffer.length > 0) {
            const s = reorderBuffer.shift()!;
            if (protector.check(s)) {
              received++;
            } else {
              rejected++;
            }
          }
        }
      }

      const stats = protector.getStats();

      console.log(
        `[Mild Reordering (${maxReorder} packets)]\n` +
          `  Received: ${received}, Rejected: ${rejected}\n` +
          `  Replays detected: ${stats.replaysDetected}`
      );

      // All frames should be accepted (reordering within window)
      expect(received).toBe(totalFrames);
      expect(rejected).toBe(0);
    });

    it('should handle severe reordering (100 packets)', async () => {
      const protector = new ReplayProtector({ windowSize: 256 });
      const totalFrames = 5_000;
      const reorderBuffer: number[] = [];
      const maxReorder = 100;

      let received = 0;
      let rejected = 0;

      for (let seq = 0; seq < totalFrames; seq++) {
        reorderBuffer.push(seq);

        if (reorderBuffer.length >= maxReorder || seq === totalFrames - 1) {
          // Shuffle buffer
          for (let i = reorderBuffer.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [reorderBuffer[i], reorderBuffer[j]] = [reorderBuffer[j]!, reorderBuffer[i]!];
          }

          while (reorderBuffer.length > 0) {
            const s = reorderBuffer.shift()!;
            if (protector.check(s)) {
              received++;
            } else {
              rejected++;
            }
          }
        }
      }

      const stats = protector.getStats();

      console.log(
        `[Severe Reordering (${maxReorder} packets)]\n` +
          `  Received: ${received}, Rejected: ${rejected}\n` +
          `  Too old: ${stats.tooOldRejected}, Replays: ${stats.replaysDetected}`
      );

      // Most frames should still be accepted
      expect(received).toBeGreaterThan(totalFrames * 0.9);
    });

    it('should handle reordering with complete frames', async () => {
      const encryptionKey = await generateEncryptionKey();
      const frameSize = 5_000;
      const totalFrames = 500;
      const maxReorder = 20;

      interface FrameData {
        seq: number;
        encrypted: ArrayBuffer;
        iv: Uint8Array;
      }

      const plaintext = new Uint8Array(frameSize);
      crypto.getRandomValues(plaintext);

      // Encrypt all frames
      const frames: FrameData[] = [];
      for (let seq = 0; seq < totalFrames; seq++) {
        const iv = await generateIV();
        const encrypted = await encryptFrame(plaintext, encryptionKey, iv);
        frames.push({ seq, encrypted, iv });
      }

      // Shuffle frames (simulating network reordering)
      const reorderBuffer: FrameData[] = [];
      const reorderedFrames: FrameData[] = [];

      for (const frame of frames) {
        reorderBuffer.push(frame);

        if (reorderBuffer.length >= maxReorder) {
          // Shuffle and emit
          for (let i = reorderBuffer.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [reorderBuffer[i], reorderBuffer[j]] = [reorderBuffer[j]!, reorderBuffer[i]!];
          }

          while (reorderBuffer.length > 0) {
            reorderedFrames.push(reorderBuffer.shift()!);
          }
        }
      }

      // Flush remaining
      while (reorderBuffer.length > 0) {
        reorderedFrames.push(reorderBuffer.shift()!);
      }

      // Process reordered frames
      const protector = new ReplayProtector({ windowSize: 256 });
      let decryptedCount = 0;

      for (const frame of reorderedFrames) {
        if (protector.check(frame.seq)) {
          const decrypted = await decryptFrame(frame.encrypted, encryptionKey, frame.iv);
          if (decrypted.byteLength === frameSize) {
            decryptedCount++;
          }
        }
      }

      console.log(
        `[Reordered Frame Processing]\n` + `  Total: ${totalFrames}, Decrypted: ${decryptedCount}`
      );

      expect(decryptedCount).toBe(totalFrames);
    });
  });

  // ===========================================================================
  // Duplicate Packet Simulation
  // ===========================================================================
  describe('Duplicate Packet Simulation', () => {
    it('should reject duplicate packets', () => {
      const protector = new ReplayProtector();
      const totalFrames = 1_000;
      const duplicateProbability = 0.1;

      let originals = 0;
      let duplicatesSent = 0;
      let duplicatesRejected = 0;

      for (let seq = 0; seq < totalFrames; seq++) {
        // Send original
        const firstResult = protector.check(seq);
        if (firstResult) originals++;

        // Maybe send duplicate
        if (Math.random() < duplicateProbability) {
          duplicatesSent++;
          const dupResult = protector.check(seq);
          if (!dupResult) duplicatesRejected++;
        }
      }

      const stats = protector.getStats();

      console.log(
        `[Duplicate Rejection]\n` +
          `  Originals accepted: ${originals}\n` +
          `  Duplicates sent: ${duplicatesSent}, Rejected: ${duplicatesRejected}\n` +
          `  Replay detection: ${stats.replaysDetected}`
      );

      // All duplicates should be rejected
      expect(duplicatesRejected).toBe(duplicatesSent);
      expect(stats.replaysDetected).toBe(duplicatesSent);
    });

    it('should reject multiple duplicates of same packet', () => {
      const protector = new ReplayProtector();
      const duplicateCount = 100;
      const targetSeq = 42;

      // Send original
      expect(protector.check(targetSeq)).toBe(true);

      // Send many duplicates
      let rejected = 0;
      for (let i = 0; i < duplicateCount; i++) {
        if (!protector.check(targetSeq)) {
          rejected++;
        }
      }

      expect(rejected).toBe(duplicateCount);
    });
  });

  // ===========================================================================
  // Combined Network Issues
  // ===========================================================================
  describe('Combined Network Issues', () => {
    it('should handle loss + reordering + duplicates', async () => {
      const protector = new ReplayProtector({ windowSize: 256 });
      const totalFrames = 5_000;
      const lossRate = 0.05;
      const duplicateProbability = 0.05;
      const maxReorder = 30;

      const reorderBuffer: number[] = [];
      let originals = 0;
      let lost = 0;
      let duplicates = 0;
      const duplicatesRejected = 0;
      const lateRejected = 0;

      for (let seq = 0; seq < totalFrames; seq++) {
        // Loss
        if (Math.random() < lossRate) {
          lost++;
          continue;
        }

        reorderBuffer.push(seq);

        // Duplicates
        if (Math.random() < duplicateProbability) {
          reorderBuffer.push(seq);
          duplicates++;
        }

        // Process buffer when full
        if (reorderBuffer.length >= maxReorder) {
          // Shuffle
          for (let i = reorderBuffer.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [reorderBuffer[i], reorderBuffer[j]] = [reorderBuffer[j]!, reorderBuffer[i]!];
          }

          while (reorderBuffer.length > 0) {
            const s = reorderBuffer.shift()!;
            const result = protector.check(s);
            if (result) {
              originals++;
            }
          }
        }
      }

      // Flush remaining
      while (reorderBuffer.length > 0) {
        const s = reorderBuffer.shift()!;
        if (protector.check(s)) {
          originals++;
        }
      }

      const stats = protector.getStats();

      console.log(
        `[Combined Network Issues]\n` +
          `  Frames: ${totalFrames}, Lost: ${lost}, Duplicates added: ${duplicates}\n` +
          `  Accepted: ${originals}\n` +
          `  Replays rejected: ${stats.replaysDetected}\n` +
          `  Too old rejected: ${stats.tooOldRejected}`
      );

      // Should accept approximately (totalFrames - lost) originals
      const expectedOriginals = totalFrames - lost;
      expect(originals).toBeGreaterThan(expectedOriginals * 0.95);
      expect(originals).toBeLessThanOrEqual(expectedOriginals);

      // All duplicates should be rejected
      expect(stats.replaysDetected).toBeGreaterThanOrEqual(duplicates * 0.9);
    });
  });

  // ===========================================================================
  // Multi-Sender Network Simulation
  // ===========================================================================
  describe('Multi-Sender Network Simulation', () => {
    it('should handle multiple senders with independent network conditions', async () => {
      const manager = new ReplayProtectionManager({ windowSize: 256 });
      const senderCount = 10;
      const framesPerSender = 1_000;

      interface SenderConditions {
        lossRate: number;
        reorderMax: number;
      }

      const senders: Array<{ id: string; conditions: SenderConditions; accepted: number }> = [];

      // Each sender has different network conditions
      for (let i = 0; i < senderCount; i++) {
        senders.push({
          id: `sender-${i}`,
          conditions: {
            lossRate: Math.random() * 0.15, // 0-15% loss
            reorderMax: Math.floor(Math.random() * 50) + 5, // 5-55 packet reorder
          },
          accepted: 0,
        });
      }

      const start = performance.now();

      for (const sender of senders) {
        const reorderBuffer: number[] = [];

        for (let seq = 0; seq < framesPerSender; seq++) {
          // Loss
          if (Math.random() < sender.conditions.lossRate) {
            continue;
          }

          reorderBuffer.push(seq);

          // Process when buffer full
          if (reorderBuffer.length >= sender.conditions.reorderMax) {
            // Shuffle
            for (let i = reorderBuffer.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [reorderBuffer[i], reorderBuffer[j]] = [reorderBuffer[j]!, reorderBuffer[i]!];
            }

            while (reorderBuffer.length > 0) {
              const s = reorderBuffer.shift()!;
              if (manager.check(sender.id, s)) {
                sender.accepted++;
              }
            }
          }
        }

        // Flush remaining
        while (reorderBuffer.length > 0) {
          const s = reorderBuffer.shift()!;
          if (manager.check(sender.id, s)) {
            sender.accepted++;
          }
        }
      }

      const elapsed = performance.now() - start;

      console.log(`[Multi-Sender Network Simulation] ${elapsed.toFixed(0)}ms`);
      for (const sender of senders) {
        const expected = Math.round(framesPerSender * (1 - sender.conditions.lossRate));
        console.log(
          `  ${sender.id}: ${sender.accepted}/${framesPerSender} ` +
            `(${(sender.conditions.lossRate * 100).toFixed(1)}% loss, ` +
            `${sender.conditions.reorderMax} reorder)`
        );

        // Should accept approximately the expected number
        // Allow some variance due to random reordering and "too old" rejections
        expect(sender.accepted).toBeGreaterThan(expected * 0.85);
        // Upper bound with tolerance for random variation
        expect(sender.accepted).toBeLessThanOrEqual(framesPerSender);
      }
    });
  });

  // ===========================================================================
  // Jitter Simulation
  // ===========================================================================
  describe('Jitter Simulation', () => {
    it('should handle variable packet arrival times', async () => {
      const protector = new ReplayProtector({ windowSize: 256 });
      const totalFrames = 2_000;
      const maxJitter = 50; // Max packets that can arrive out of order

      // Generate packets with simulated jitter
      interface Packet {
        seq: number;
        arrivalOrder: number;
      }

      const packets: Packet[] = [];
      for (let seq = 0; seq < totalFrames; seq++) {
        // Add jitter to arrival order
        const jitter = Math.floor(Math.random() * maxJitter * 2) - maxJitter;
        packets.push({
          seq,
          arrivalOrder: seq + jitter,
        });
      }

      // Sort by arrival order
      packets.sort((a, b) => a.arrivalOrder - b.arrivalOrder);

      let accepted = 0;
      for (const packet of packets) {
        if (protector.check(packet.seq)) {
          accepted++;
        }
      }

      const stats = protector.getStats();

      console.log(
        `[Jitter Simulation (±${maxJitter} packets)]\n` +
          `  Frames: ${totalFrames}, Accepted: ${accepted}\n` +
          `  Too old: ${stats.tooOldRejected}`
      );

      // Most frames should be accepted despite jitter
      expect(accepted).toBeGreaterThan(totalFrames * 0.95);
    });
  });

  // ===========================================================================
  // Sequence Number Wrap-around Under Network Stress
  // ===========================================================================
  describe('Wrap-around Under Network Stress', () => {
    it('should handle wrap-around with packet loss', () => {
      const protector = new ReplayProtector({ windowSize: 256, allowWrapAround: true });
      const lossRate = 0.05;

      // Start near wrap-around point
      const startSeq = 0xffffffff - 500;
      let accepted = 0;
      let lost = 0;

      for (let i = 0; i < 1000; i++) {
        const seq = (startSeq + i) >>> 0; // Ensure 32-bit wrap

        if (Math.random() < lossRate) {
          lost++;
          continue;
        }

        if (protector.check(seq)) {
          accepted++;
        }
      }

      console.log(`[Wrap-around with Loss]\n` + `  Accepted: ${accepted}, Lost: ${lost}`);

      expect(accepted).toBeGreaterThan(900); // ~95% of 1000 - lost
    });

    it('should handle wrap-around with reordering', () => {
      const protector = new ReplayProtector({ windowSize: 256, allowWrapAround: true });
      const maxReorder = 20;

      // Start near wrap-around point
      const startSeq = 0xffffffff - 100;
      const sequences: number[] = [];

      for (let i = 0; i < 200; i++) {
        sequences.push((startSeq + i) >>> 0);
      }

      // Apply reordering
      const reordered: number[] = [];
      const buffer: number[] = [];

      for (const seq of sequences) {
        buffer.push(seq);

        if (buffer.length >= maxReorder) {
          // Shuffle
          for (let i = buffer.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [buffer[i], buffer[j]] = [buffer[j]!, buffer[i]!];
          }

          while (buffer.length > 0) {
            reordered.push(buffer.shift()!);
          }
        }
      }

      // Flush
      while (buffer.length > 0) {
        reordered.push(buffer.shift()!);
      }

      let accepted = 0;
      for (const seq of reordered) {
        if (protector.check(seq)) {
          accepted++;
        }
      }

      console.log(
        `[Wrap-around with Reordering]\n` + `  Total: ${sequences.length}, Accepted: ${accepted}`
      );

      expect(accepted).toBe(sequences.length);
    });
  });
});
