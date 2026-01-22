/**
 * @fileoverview Battle tests for key rotation under load
 * Tests key changes during active streaming scenarios
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateEncryptionKey,
  encryptFrame,
  decryptFrame,
  serializeFrame,
  deserializeFrame,
} from '@core/crypto/aes-gcm';
import type { KeyGeneration } from '../../src/types';
import { SenderKeyManager } from '@sfu/sender-keys';
import { KeyManager } from '@core/key-manager';
import { generateKeyPair, deriveSharedSecret, deriveEncryptionKey } from '@core/crypto/ecdh';

describe('Key Rotation Battle Tests', () => {
  const generation = 1 as KeyGeneration;

  // ===========================================================================
  // Single Participant Key Rotation
  // ===========================================================================
  describe('Single Participant Key Rotation', () => {
    it('should handle key rotation during continuous streaming', async () => {
      const manager = new SenderKeyManager({ participantId: 'test-sender' });
      const frameSize = 50_000;
      const totalFrames = 1000;
      const rotationInterval = 100; // Rotate every 100 frames

      await manager.generateLocalKey();

      const plaintext = new Uint8Array(frameSize);
      crypto.getRandomValues(plaintext.subarray(0, Math.min(65536, frameSize)));

      const start = performance.now();
      let rotations = 0;
      let framesProcessed = 0;

      for (let i = 0; i < totalFrames; i++) {
        // Rotate key periodically
        if (i > 0 && i % rotationInterval === 0) {
          await manager.generateLocalKey();
          rotations++;
        }

        const key = manager.currentKey;
        expect(key).not.toBeNull();

        const encrypted = await encryptFrame(plaintext, key!.key, generation);
        const decrypted = await decryptFrame(encrypted, key!.key);
        expect(decrypted.byteLength).toBe(frameSize);
        framesProcessed++;
      }

      const elapsed = performance.now() - start;
      const fps = framesProcessed / (elapsed / 1000);

      console.log(
        `[Key Rotation During Stream]\n` +
          `  Frames: ${framesProcessed}, Rotations: ${rotations}\n` +
          `  Time: ${elapsed.toFixed(0)}ms, FPS: ${fps.toFixed(1)}`
      );

      expect(rotations).toBe(Math.floor((totalFrames - 1) / rotationInterval));
    });

    it('should handle rapid key generation', async () => {
      const manager = new SenderKeyManager({ participantId: 'test-sender', maxKeyHistory: 3 });
      const frameSize = 10_000;
      const keyCount = 20;

      const plaintext = new Uint8Array(frameSize);
      crypto.getRandomValues(plaintext);

      const start = performance.now();

      // Generate many keys rapidly
      for (let i = 0; i < keyCount; i++) {
        await manager.generateLocalKey();

        // Encrypt/decrypt with current key
        const key = manager.currentKey;
        expect(key).not.toBeNull();

        const encrypted = await encryptFrame(plaintext, key!.key, generation);
        const decrypted = await decryptFrame(encrypted, key!.key);
        expect(decrypted.byteLength).toBe(frameSize);
      }

      const elapsed = performance.now() - start;
      const rotationsPerSec = keyCount / (elapsed / 1000);

      console.log(
        `[Rapid Key Generation]\n` +
          `  ${keyCount} keys generated in ${elapsed.toFixed(0)}ms\n` +
          `  ${rotationsPerSec.toFixed(1)} keys/sec`
      );
    });
  });

  // ===========================================================================
  // Multi-Participant Key Rotation
  // ===========================================================================
  describe('Multi-Participant Key Rotation', () => {
    it('should handle concurrent key rotations from multiple participants', async () => {
      const participantCount = 10;
      const framesPerParticipant = 200;
      const rotationInterval = 50;

      const participants = await Promise.all(
        Array.from({ length: participantCount }, async (_, i) => {
          const manager = new SenderKeyManager({ participantId: `participant-${i}` });
          await manager.generateLocalKey();
          return { id: `participant-${i}`, manager, rotations: 0 };
        })
      );

      const frameSize = 20_000;
      const plaintext = new Uint8Array(frameSize);
      crypto.getRandomValues(plaintext);

      const start = performance.now();
      let totalFrames = 0;
      let totalRotations = 0;

      // Simulate concurrent streaming with rotations
      await Promise.all(
        participants.map(async (participant) => {
          for (let f = 0; f < framesPerParticipant; f++) {
            // Rotate key periodically
            if (f > 0 && f % rotationInterval === 0) {
              await participant.manager.generateLocalKey();
              participant.rotations++;
            }

            const key = participant.manager.currentKey;
            expect(key).not.toBeNull();

            const encrypted = await encryptFrame(plaintext, key!.key, generation);
            const decrypted = await decryptFrame(encrypted, key!.key);
            expect(decrypted.byteLength).toBe(frameSize);
            totalFrames++;
          }
          totalRotations += participant.rotations;
        })
      );

      const elapsed = performance.now() - start;
      const fps = totalFrames / (elapsed / 1000);

      console.log(
        `[Multi-Participant Key Rotation]\n` +
          `  Participants: ${participantCount}\n` +
          `  Total frames: ${totalFrames}, Total rotations: ${totalRotations}\n` +
          `  Time: ${elapsed.toFixed(0)}ms, Combined FPS: ${fps.toFixed(1)}`
      );
    });

    it('should handle staggered key rotations', async () => {
      const participantCount = 5;
      const totalFrames = 500;

      const participants = await Promise.all(
        Array.from({ length: participantCount }, async (_, i) => {
          const manager = new SenderKeyManager({ participantId: `participant-${i}` });
          await manager.generateLocalKey();
          // Each participant rotates at different intervals
          return {
            id: `participant-${i}`,
            manager,
            rotationInterval: 50 + i * 20, // 50, 70, 90, 110, 130
            rotations: 0,
          };
        })
      );

      const frameSize = 10_000;
      const plaintext = new Uint8Array(frameSize);
      crypto.getRandomValues(plaintext);

      const start = performance.now();

      for (let frame = 0; frame < totalFrames; frame++) {
        await Promise.all(
          participants.map(async (participant) => {
            // Check if this participant should rotate
            if (frame > 0 && frame % participant.rotationInterval === 0) {
              await participant.manager.generateLocalKey();
              participant.rotations++;
            }

            const key = participant.manager.currentKey;
            const encrypted = await encryptFrame(plaintext, key!.key, generation);
            const decrypted = await decryptFrame(encrypted, key!.key);
            expect(decrypted.byteLength).toBe(frameSize);
          })
        );
      }

      const elapsed = performance.now() - start;

      console.log(
        `[Staggered Key Rotation]\n` +
          participants
            .map((p) => `  ${p.id}: ${p.rotations} rotations (every ${p.rotationInterval} frames)`)
            .join('\n')
      );

      // Verify rotations match expectations
      for (const p of participants) {
        const expectedRotations = Math.floor((totalFrames - 1) / p.rotationInterval);
        expect(p.rotations).toBe(expectedRotations);
      }
    });
  });

  // ===========================================================================
  // KeyManager Integration Under Load
  // ===========================================================================
  describe('KeyManager Integration Under Load', () => {
    let keyManager: KeyManager;

    beforeEach(async () => {
      keyManager = new KeyManager({
        keyHistorySize: 3,
        autoRotate: false,
      });
    });

    it('should handle rapid key generation and rotation', async () => {
      const rotations = 50;
      const frameSize = 10_000;

      const plaintext = new Uint8Array(frameSize);
      crypto.getRandomValues(plaintext);

      const start = performance.now();

      for (let i = 0; i < rotations; i++) {
        const key = await keyManager.generateKey();
        expect(key).toBeDefined();

        const encrypted = await encryptFrame(plaintext, key, generation);
        const decrypted = await decryptFrame(encrypted, key);
        expect(decrypted.byteLength).toBe(frameSize);
      }

      const elapsed = performance.now() - start;

      console.log(`[KeyManager Rapid Rotation] ${rotations} rotations in ${elapsed.toFixed(0)}ms`);
    });

    it('should handle key exchange handshake under load', async () => {
      const participantPairs = 20;
      const handshakes: Array<{ local: string; remote: string }> = [];

      // Generate ECDH key pairs for simulated handshake
      const keyPairs = await Promise.all(
        Array.from({ length: participantPairs * 2 }, () => generateKeyPair())
      );

      const start = performance.now();

      for (let i = 0; i < participantPairs; i++) {
        const localId = `local-${i}`;
        const remoteId = `remote-${i}`;

        // Simulate key exchange
        const localKeyPair = keyPairs[i * 2]!;
        const remoteKeyPair = keyPairs[i * 2 + 1]!;

        // Derive shared secret (both directions should match)
        const localShared = await deriveSharedSecret(
          localKeyPair.privateKey,
          remoteKeyPair.publicKey
        );
        const remoteShared = await deriveSharedSecret(
          remoteKeyPair.privateKey,
          localKeyPair.publicKey
        );

        // Derive encryption keys
        const localEncKey = await deriveEncryptionKey(localShared);
        const remoteEncKey = await deriveEncryptionKey(remoteShared);

        // Verify keys work for encryption/decryption
        const plaintext = new TextEncoder().encode(`test-${i}`);
        const encrypted = await encryptFrame(plaintext, localEncKey, generation);
        const decrypted = await decryptFrame(encrypted, remoteEncKey);

        expect(new TextDecoder().decode(decrypted)).toBe(`test-${i}`);
        handshakes.push({ local: localId, remote: remoteId });
      }

      const elapsed = performance.now() - start;
      const handshakesPerSec = handshakes.length / (elapsed / 1000);

      console.log(
        `[Key Exchange Handshakes]\n` +
          `  ${handshakes.length} handshakes in ${elapsed.toFixed(0)}ms\n` +
          `  ${handshakesPerSec.toFixed(1)} handshakes/sec`
      );
    });
  });

  // ===========================================================================
  // Generation Tracking Under Load
  // ===========================================================================
  describe('Generation Tracking Under Load', () => {
    it('should correctly track generations with frame serialization', async () => {
      const frameSize = 5_000;
      const framesPerGeneration = 50;
      const totalGenerations = 5;

      // Use simple key array for generation tracking
      const keys: Array<{ key: CryptoKey; generation: number }> = [];

      const allFrames: Array<{
        serialized: Uint8Array;
        generation: number;
      }> = [];

      const start = performance.now();

      // Encrypt frames across multiple generations
      for (let gen = 1; gen <= totalGenerations; gen++) {
        const key = await generateEncryptionKey();
        keys.push({ key, generation: gen });

        for (let f = 0; f < framesPerGeneration; f++) {
          const plaintext = new Uint8Array(frameSize);
          plaintext.fill(gen); // Fill with generation for verification

          const encrypted = await encryptFrame(plaintext, key, gen as KeyGeneration);
          const serialized = serializeFrame(encrypted);
          allFrames.push({ serialized, generation: gen });
        }
      }

      const encryptTime = performance.now() - start;

      // Shuffle frames to simulate out-of-order arrival
      for (let i = allFrames.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allFrames[i], allFrames[j]] = [allFrames[j]!, allFrames[i]!];
      }

      const decryptStart = performance.now();
      let decryptedCount = 0;
      let failedCount = 0;

      // Decrypt in shuffled order
      for (const frame of allFrames) {
        const { generation: frameGen, iv, ciphertext } = deserializeFrame(frame.serialized);

        const keyEntry = keys.find((k) => k.generation === frameGen);
        if (keyEntry) {
          try {
            const decrypted = await decryptFrame(
              { generation: frameGen, iv, ciphertext },
              keyEntry.key
            );
            // Verify content
            if (decrypted[0] === frameGen) {
              decryptedCount++;
            }
          } catch {
            failedCount++;
          }
        } else {
          failedCount++;
        }
      }

      const decryptTime = performance.now() - decryptStart;

      console.log(
        `[Generation Tracking]\n` +
          `  ${allFrames.length} frames across ${totalGenerations} generations\n` +
          `  Encrypt: ${encryptTime.toFixed(0)}ms, Decrypt (shuffled): ${decryptTime.toFixed(0)}ms\n` +
          `  Decrypted: ${decryptedCount}, Failed: ${failedCount}`
      );

      // All frames should decrypt
      expect(decryptedCount).toBe(allFrames.length);
    });
  });

  // ===========================================================================
  // Burst Key Rotation
  // ===========================================================================
  describe('Burst Key Rotation', () => {
    it('should handle burst of rapid key rotations', async () => {
      const manager = new SenderKeyManager({ participantId: 'test-sender' });
      const burstSize = 50;

      const start = performance.now();
      const generations: number[] = [];

      // Rapid burst of rotations
      for (let i = 0; i < burstSize; i++) {
        const senderKey = await manager.generateLocalKey();
        generations.push(senderKey.generation);
      }

      const elapsed = performance.now() - start;
      const rotationsPerSec = burstSize / (elapsed / 1000);

      console.log(
        `[Burst Rotation] ${burstSize} rotations in ${elapsed.toFixed(0)}ms\n` +
          `  ${rotationsPerSec.toFixed(0)} rotations/sec\n` +
          `  Final generation: ${generations[generations.length - 1]}`
      );

      // Current key should be available
      expect(manager.currentKey).not.toBeNull();
    });

    it('should recover gracefully after burst rotation', async () => {
      const manager = new SenderKeyManager({ participantId: 'test-sender', maxKeyHistory: 3 });
      const frameSize = 10_000;
      const burstSize = 20;

      // Normal operation
      await manager.generateLocalKey();
      let currentKey = manager.currentKey!;

      const plaintext = new Uint8Array(frameSize);
      crypto.getRandomValues(plaintext);

      // Encrypt some frames with initial key
      const preburstKey = currentKey.key;
      const preburstFrames: Array<{ encrypted: Awaited<ReturnType<typeof encryptFrame>> }> = [];
      for (let i = 0; i < 10; i++) {
        const encrypted = await encryptFrame(plaintext, preburstKey, generation);
        preburstFrames.push({ encrypted });
      }

      // Burst rotation
      for (let i = 0; i < burstSize; i++) {
        await manager.generateLocalKey();
      }

      // Get new current key
      currentKey = manager.currentKey!;

      // Encrypt more frames after burst
      const postburstFrames: Array<{ encrypted: Awaited<ReturnType<typeof encryptFrame>> }> = [];
      for (let i = 0; i < 10; i++) {
        const encrypted = await encryptFrame(plaintext, currentKey.key, generation);
        postburstFrames.push({ encrypted });
      }

      // Pre-burst frames should fail (key was rotated out)
      let preFailed = 0;
      for (const frame of preburstFrames) {
        try {
          await decryptFrame(frame.encrypted, currentKey.key);
        } catch {
          preFailed++;
        }
      }

      // Post-burst frames should succeed
      let postSuccess = 0;
      for (const frame of postburstFrames) {
        try {
          const decrypted = await decryptFrame(frame.encrypted, currentKey.key);
          if (decrypted.byteLength === frameSize) postSuccess++;
        } catch {
          // Decryption failed
        }
      }

      console.log(
        `[Post-Burst Recovery]\n` +
          `  Pre-burst frames failed: ${preFailed}/${preburstFrames.length} (expected: wrong key)\n` +
          `  Post-burst frames success: ${postSuccess}/${postburstFrames.length}`
      );

      expect(preFailed).toBe(preburstFrames.length);
      expect(postSuccess).toBe(postburstFrames.length);
    });
  });
});
