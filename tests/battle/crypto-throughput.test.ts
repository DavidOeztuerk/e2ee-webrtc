/**
 * @fileoverview Battle tests for cryptographic throughput
 * Tests encryption/decryption performance under load
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  generateEncryptionKey,
  encryptFrame,
  decryptFrame,
  serializeFrame,
  deserializeFrame,
} from '@core/crypto/aes-gcm';
import type { EncryptedFrame, KeyGeneration } from '../../src/types';

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

describe('Crypto Throughput Battle Tests', () => {
  let encryptionKey: CryptoKey;
  const generation = 1 as KeyGeneration;

  beforeAll(async () => {
    encryptionKey = await generateEncryptionKey();
  });

  afterAll(() => {
    encryptionKey = null!;
  });

  // ===========================================================================
  // Frame Size Variations
  // ===========================================================================
  describe('Frame Size Variations', () => {
    const frameSizes = [
      { name: 'audio (20ms)', size: 160 },
      { name: 'audio (40ms)', size: 320 },
      { name: '360p video', size: 50_000 },
      { name: '720p video', size: 150_000 },
      { name: '1080p video', size: 500_000 },
    ];

    for (const { name, size } of frameSizes) {
      it(`should encrypt/decrypt ${name} frames (${size} bytes)`, async () => {
        const plaintext = new Uint8Array(size);
        fillRandomBuffer(plaintext);

        const iterations = size > 100_000 ? 10 : 50;
        const startEncrypt = performance.now();

        for (let i = 0; i < iterations; i++) {
          const encrypted = await encryptFrame(plaintext, encryptionKey, generation);
          expect(encrypted.ciphertext.byteLength).toBeGreaterThan(size);
        }

        const encryptTime = performance.now() - startEncrypt;
        const encryptThroughput = (size * iterations) / (encryptTime / 1000) / 1024 / 1024;

        console.log(
          `[${name}] Encrypt: ${(encryptTime / iterations).toFixed(2)}ms/frame, ` +
            `${encryptThroughput.toFixed(2)} MB/s`
        );

        // Decrypt test
        const encrypted = await encryptFrame(plaintext, encryptionKey, generation);

        const startDecrypt = performance.now();

        for (let i = 0; i < iterations; i++) {
          const decrypted = await decryptFrame(encrypted, encryptionKey);
          expect(decrypted.byteLength).toBe(size);
        }

        const decryptTime = performance.now() - startDecrypt;
        const decryptThroughput = (size * iterations) / (decryptTime / 1000) / 1024 / 1024;

        console.log(
          `[${name}] Decrypt: ${(decryptTime / iterations).toFixed(2)}ms/frame, ` +
            `${decryptThroughput.toFixed(2)} MB/s`
        );
      });
    }
  });

  // ===========================================================================
  // Sustained Throughput
  // ===========================================================================
  describe('Sustained Throughput', () => {
    it('should handle 30 fps video stream (720p) simulation', async () => {
      const frameSize = 150_000;
      const fps = 30;
      const duration = 3; // 3 seconds
      const totalFrames = fps * duration;

      const plaintext = new Uint8Array(frameSize);
      fillRandomBuffer(plaintext);

      const start = performance.now();
      let framesProcessed = 0;

      for (let i = 0; i < totalFrames; i++) {
        const encrypted = await encryptFrame(plaintext, encryptionKey, generation);
        const decrypted = await decryptFrame(encrypted, encryptionKey);
        expect(decrypted.byteLength).toBe(frameSize);
        framesProcessed++;
      }

      const elapsed = performance.now() - start;
      const actualFps = framesProcessed / (elapsed / 1000);
      const throughput = (frameSize * framesProcessed * 2) / (elapsed / 1000) / 1024 / 1024;

      console.log(
        `[Sustained 720p@30fps] Processed ${framesProcessed} frames in ${elapsed.toFixed(0)}ms\n` +
          `  Effective FPS: ${actualFps.toFixed(1)}\n` +
          `  Throughput: ${throughput.toFixed(2)} MB/s`
      );

      // Should be able to handle at least 10 fps for the test environment
      expect(actualFps).toBeGreaterThan(10);
    });

    it('should handle mixed audio/video stream', async () => {
      const videoFrameSize = 50_000;
      const audioFrameSize = 160;
      const duration = 2;
      const videoFrames = 30 * duration;
      const audioFrames = 50 * duration;

      const videoPlaintext = new Uint8Array(videoFrameSize);
      const audioPlaintext = new Uint8Array(audioFrameSize);
      fillRandomBuffer(videoPlaintext);
      fillRandomBuffer(audioPlaintext);

      const start = performance.now();
      let videoProcessed = 0;
      let audioProcessed = 0;

      // Interleave audio and video
      for (let i = 0; i < Math.max(videoFrames, audioFrames); i++) {
        if (i < videoFrames) {
          const encrypted = await encryptFrame(videoPlaintext, encryptionKey, generation);
          await decryptFrame(encrypted, encryptionKey);
          videoProcessed++;
        }

        if (i < audioFrames) {
          const encrypted = await encryptFrame(audioPlaintext, encryptionKey, generation);
          await decryptFrame(encrypted, encryptionKey);
          audioProcessed++;
        }
      }

      const elapsed = performance.now() - start;
      const totalBytes = videoProcessed * videoFrameSize + audioProcessed * audioFrameSize;
      const throughput = (totalBytes * 2) / (elapsed / 1000) / 1024 / 1024;

      console.log(
        `[Mixed A/V Stream]\n` +
          `  Video: ${videoProcessed} frames (${(videoProcessed / (elapsed / 1000)).toFixed(1)} fps)\n` +
          `  Audio: ${audioProcessed} frames (${(audioProcessed / (elapsed / 1000)).toFixed(1)} pps)\n` +
          `  Combined throughput: ${throughput.toFixed(2)} MB/s`
      );
    });
  });

  // ===========================================================================
  // Parallel Processing
  // ===========================================================================
  describe('Parallel Processing', () => {
    it('should handle parallel encryption/decryption', async () => {
      const frameSize = 50_000;
      const parallelCount = 5;
      const iterations = 20;

      const plaintext = new Uint8Array(frameSize);
      fillRandomBuffer(plaintext);

      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        // Encrypt all in parallel
        const encryptPromises = Array.from({ length: parallelCount }, async () => {
          return encryptFrame(plaintext, encryptionKey, generation);
        });

        const encryptedFrames = await Promise.all(encryptPromises);

        // Decrypt all in parallel
        const decryptPromises = encryptedFrames.map((encrypted) =>
          decryptFrame(encrypted, encryptionKey)
        );

        const decryptedFrames = await Promise.all(decryptPromises);

        for (const decrypted of decryptedFrames) {
          expect(decrypted.byteLength).toBe(frameSize);
        }
      }

      const elapsed = performance.now() - start;
      const totalFrames = parallelCount * iterations * 2;
      const throughput = (frameSize * totalFrames) / (elapsed / 1000) / 1024 / 1024;

      console.log(
        `[Parallel ${parallelCount}x] ${totalFrames} operations in ${elapsed.toFixed(0)}ms\n` +
          `  ${(totalFrames / (elapsed / 1000)).toFixed(1)} ops/sec\n` +
          `  Throughput: ${throughput.toFixed(2)} MB/s`
      );
    });

    it('should handle concurrent streams from multiple participants', async () => {
      const participantCount = 3;
      const framesPerParticipant = 30;
      const frameSize = 50_000;

      // Generate unique keys per participant
      const participants = await Promise.all(
        Array.from({ length: participantCount }, async (_, i) => {
          const plaintext = new Uint8Array(frameSize);
          plaintext.fill(i);
          return {
            id: `participant-${i}`,
            key: await generateEncryptionKey(),
            plaintext,
          };
        })
      );

      const start = performance.now();

      // All participants stream concurrently
      await Promise.all(
        participants.map(async (participant) => {
          for (let i = 0; i < framesPerParticipant; i++) {
            const encrypted = await encryptFrame(
              participant.plaintext,
              participant.key,
              generation
            );
            const decrypted = await decryptFrame(encrypted, participant.key);
            expect(decrypted[0]).toBe(participant.plaintext[0]);
          }
        })
      );

      const elapsed = performance.now() - start;
      const totalFrames = participantCount * framesPerParticipant * 2;
      const throughput = (frameSize * totalFrames) / (elapsed / 1000) / 1024 / 1024;

      console.log(
        `[${participantCount} Concurrent Participants]\n` +
          `  ${totalFrames} operations in ${elapsed.toFixed(0)}ms\n` +
          `  ${(totalFrames / (elapsed / 1000)).toFixed(1)} ops/sec\n` +
          `  Throughput: ${throughput.toFixed(2)} MB/s`
      );
    });
  });

  // ===========================================================================
  // Frame Serialization
  // ===========================================================================
  describe('Frame Serialization Performance', () => {
    it('should handle rapid serialization/deserialization', async () => {
      const iterations = 5_000;
      const frameSize = 10_000;

      const ciphertext = new Uint8Array(frameSize);
      const iv = new Uint8Array(12);
      fillRandomBuffer(ciphertext);
      fillRandomBuffer(iv);

      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        const frame: EncryptedFrame = { generation, iv, ciphertext };
        const serialized = serializeFrame(frame);
        const { generation: g, iv: parsedIv, ciphertext: c } = deserializeFrame(serialized);
        expect(g).toBe(generation);
        expect(parsedIv.byteLength).toBe(12);
        expect(c.byteLength).toBe(frameSize);
      }

      const elapsed = performance.now() - start;
      const opsPerSec = iterations / (elapsed / 1000);
      const throughput = (frameSize * iterations * 2) / (elapsed / 1000) / 1024 / 1024;

      console.log(
        `[Serialization] ${iterations} round-trips in ${elapsed.toFixed(0)}ms\n` +
          `  ${opsPerSec.toFixed(0)} ops/sec\n` +
          `  Throughput: ${throughput.toFixed(2)} MB/s`
      );

      // Should be fast since it's just memory operations
      expect(opsPerSec).toBeGreaterThan(1_000);
    });
  });
});
