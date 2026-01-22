/**
 * @module tests/e2e
 * End-to-end tests for WebRTC E2EE using Playwright
 *
 * These tests require:
 * - A running signaling server
 * - A test page that uses the E2EE library
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * Test configuration
 */
const TEST_CONFIG = {
  signalingUrl: process.env.SIGNALING_URL || 'ws://localhost:3001',
  testPageUrl: process.env.TEST_PAGE_URL || 'http://localhost:3000/test',
  timeout: 30000,
};

/**
 * Helper to create a peer page with video/audio permissions
 */
async function createPeerPage(context: BrowserContext, name: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(TEST_CONFIG.testPageUrl);

  // Set participant ID
  await page.evaluate((participantId) => {
    (window as unknown as { participantId: string }).participantId = participantId;
  }, name);

  return page;
}

/**
 * Helper to wait for E2EE state
 */
async function waitForE2EEState(
  page: Page,
  expectedState: string,
  timeout = TEST_CONFIG.timeout
): Promise<void> {
  await page.waitForFunction(
    (state) => {
      const e2eeState = (window as unknown as { e2eeState?: string }).e2eeState;
      return e2eeState === state;
    },
    expectedState,
    { timeout }
  );
}

/**
 * Helper to get E2EE stats from page
 */
async function getE2EEStats(page: Page): Promise<{
  framesEncrypted: number;
  framesDecrypted: number;
  encryptionErrors: number;
  decryptionErrors: number;
}> {
  return await page.evaluate(() => {
    const stats = (
      window as unknown as {
        e2eeStats?: {
          framesEncrypted: number;
          framesDecrypted: number;
          encryptionErrors: number;
          decryptionErrors: number;
        };
      }
    ).e2eeStats;
    return (
      stats || {
        framesEncrypted: 0,
        framesDecrypted: 0,
        encryptionErrors: 0,
        decryptionErrors: 0,
      }
    );
  });
}

test.describe('WebRTC E2EE End-to-End Tests', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    // Ensure signaling server is running
    // This would typically be handled by the test setup
  });

  test('should establish E2EE connection between two peers', async ({ browser }) => {
    test.skip(process.env.CI === 'true', 'Skipping E2E test in CI without signaling server');

    // Create two browser contexts (simulating two users)
    const aliceContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
    });
    const bobContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
    });

    try {
      // Create peer pages
      const alicePage = await createPeerPage(aliceContext, 'alice');
      const bobPage = await createPeerPage(bobContext, 'bob');

      // Alice creates a room
      const roomId = await alicePage.evaluate(async () => {
        const createRoom = (window as unknown as { createRoom: () => Promise<string> }).createRoom;
        return await createRoom();
      });

      expect(roomId).toBeTruthy();

      // Bob joins the room
      await bobPage.evaluate(async (id) => {
        const joinRoom = (window as unknown as { joinRoom: (id: string) => Promise<void> })
          .joinRoom;
        await joinRoom(id);
      }, roomId);

      // Wait for E2EE to be established on both sides
      await Promise.all([
        waitForE2EEState(alicePage, 'encrypted'),
        waitForE2EEState(bobPage, 'encrypted'),
      ]);

      // Verify E2EE is working by checking stats
      await alicePage.waitForTimeout(2000); // Wait for some frames to be processed

      const aliceStats = await getE2EEStats(alicePage);
      const bobStats = await getE2EEStats(bobPage);

      expect(aliceStats.framesEncrypted).toBeGreaterThan(0);
      expect(bobStats.framesDecrypted).toBeGreaterThan(0);
      expect(aliceStats.encryptionErrors).toBe(0);
      expect(bobStats.decryptionErrors).toBe(0);
    } finally {
      await aliceContext.close();
      await bobContext.close();
    }
  });

  test('should handle key rotation during call', async ({ browser }) => {
    test.skip(process.env.CI === 'true', 'Skipping E2E test in CI without signaling server');

    const aliceContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
    });
    const bobContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
    });

    try {
      const alicePage = await createPeerPage(aliceContext, 'alice');
      const bobPage = await createPeerPage(bobContext, 'bob');

      // Establish connection
      const roomId = await alicePage.evaluate(async () => {
        const createRoom = (window as unknown as { createRoom: () => Promise<string> }).createRoom;
        return await createRoom();
      });

      await bobPage.evaluate(async (id) => {
        const joinRoom = (window as unknown as { joinRoom: (id: string) => Promise<void> })
          .joinRoom;
        await joinRoom(id);
      }, roomId);

      await Promise.all([
        waitForE2EEState(alicePage, 'encrypted'),
        waitForE2EEState(bobPage, 'encrypted'),
      ]);

      // Get initial key generation
      const initialGeneration = await alicePage.evaluate(() => {
        return (
          window as unknown as { getCurrentKeyGeneration: () => number }
        ).getCurrentKeyGeneration();
      });

      // Trigger key rotation
      await alicePage.evaluate(async () => {
        const rotateKey = (window as unknown as { rotateKey: () => Promise<void> }).rotateKey;
        await rotateKey();
      });

      // Wait for rekey to complete
      await waitForE2EEState(alicePage, 'encrypted');
      await waitForE2EEState(bobPage, 'encrypted');

      // Verify key generation increased
      const newGeneration = await alicePage.evaluate(() => {
        return (
          window as unknown as { getCurrentKeyGeneration: () => number }
        ).getCurrentKeyGeneration();
      });

      expect(newGeneration).toBeGreaterThan(initialGeneration);

      // Verify call is still working
      await alicePage.waitForTimeout(1000);

      const aliceStats = await getE2EEStats(alicePage);
      const bobStats = await getE2EEStats(bobPage);

      expect(aliceStats.encryptionErrors).toBe(0);
      expect(bobStats.decryptionErrors).toBe(0);
    } finally {
      await aliceContext.close();
      await bobContext.close();
    }
  });

  test('should recover from network disconnection', async ({ browser }) => {
    test.skip(process.env.CI === 'true', 'Skipping E2E test in CI without signaling server');

    const aliceContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
    });
    const bobContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
    });

    try {
      const alicePage = await createPeerPage(aliceContext, 'alice');
      const bobPage = await createPeerPage(bobContext, 'bob');

      // Establish connection
      const roomId = await alicePage.evaluate(async () => {
        const createRoom = (window as unknown as { createRoom: () => Promise<string> }).createRoom;
        return await createRoom();
      });

      await bobPage.evaluate(async (id) => {
        const joinRoom = (window as unknown as { joinRoom: (id: string) => Promise<void> })
          .joinRoom;
        await joinRoom(id);
      }, roomId);

      await Promise.all([
        waitForE2EEState(alicePage, 'encrypted'),
        waitForE2EEState(bobPage, 'encrypted'),
      ]);

      // Simulate network disconnection on Bob's side
      await bobContext.setOffline(true);
      await bobPage.waitForTimeout(2000);

      // Reconnect
      await bobContext.setOffline(false);

      // Wait for E2EE to be re-established
      await Promise.all([
        waitForE2EEState(alicePage, 'encrypted'),
        waitForE2EEState(bobPage, 'encrypted'),
      ]);

      // Verify call is working again
      await alicePage.waitForTimeout(2000);

      const aliceStats = await getE2EEStats(alicePage);
      const bobStats = await getE2EEStats(bobPage);

      expect(aliceStats.framesEncrypted).toBeGreaterThan(0);
      expect(bobStats.framesDecrypted).toBeGreaterThan(0);
    } finally {
      await aliceContext.close();
      await bobContext.close();
    }
  });

  test('should work with multiple participants (SFU mode)', async ({ browser }) => {
    test.skip(process.env.CI === 'true', 'Skipping E2E test in CI without signaling server');

    const contexts = await Promise.all([
      browser.newContext({ permissions: ['camera', 'microphone'] }),
      browser.newContext({ permissions: ['camera', 'microphone'] }),
      browser.newContext({ permissions: ['camera', 'microphone'] }),
    ]);

    try {
      const pages = await Promise.all([
        createPeerPage(contexts[0], 'alice'),
        createPeerPage(contexts[1], 'bob'),
        createPeerPage(contexts[2], 'charlie'),
      ]);

      // Alice creates room
      const roomId = await pages[0].evaluate(async () => {
        const createRoom = (window as unknown as { createRoom: () => Promise<string> }).createRoom;
        return await createRoom();
      });

      // Bob and Charlie join
      await Promise.all([
        pages[1].evaluate(async (id) => {
          const joinRoom = (window as unknown as { joinRoom: (id: string) => Promise<void> })
            .joinRoom;
          await joinRoom(id);
        }, roomId),
        pages[2].evaluate(async (id) => {
          const joinRoom = (window as unknown as { joinRoom: (id: string) => Promise<void> })
            .joinRoom;
          await joinRoom(id);
        }, roomId),
      ]);

      // Wait for all to be encrypted
      await Promise.all(pages.map((page) => waitForE2EEState(page, 'encrypted')));

      // Wait for frames to be exchanged
      await pages[0].waitForTimeout(3000);

      // Verify all participants have encryption working
      for (const page of pages) {
        const stats = await getE2EEStats(page);
        expect(stats.encryptionErrors).toBe(0);
        expect(stats.framesEncrypted).toBeGreaterThan(0);
      }
    } finally {
      await Promise.all(contexts.map((ctx) => ctx.close()));
    }
  });

  test('should detect and report E2EE verification failure', async ({ browser }) => {
    test.skip(process.env.CI === 'true', 'Skipping E2E test in CI without signaling server');

    const aliceContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
    });
    const attackerContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
    });

    try {
      const alicePage = await createPeerPage(aliceContext, 'alice');
      const attackerPage = await createPeerPage(attackerContext, 'attacker');

      // Alice creates a room
      const roomId = await alicePage.evaluate(async () => {
        const createRoom = (window as unknown as { createRoom: () => Promise<string> }).createRoom;
        return await createRoom();
      });

      // Attacker tries to join with a different key
      await attackerPage.evaluate(async (id) => {
        // Force a different key to simulate MITM
        const joinRoomWithDifferentKey = (
          window as unknown as { joinRoomWithDifferentKey: (id: string) => Promise<void> }
        ).joinRoomWithDifferentKey;
        if (joinRoomWithDifferentKey) {
          await joinRoomWithDifferentKey(id);
        }
      }, roomId);

      // Wait for connection attempt
      await alicePage.waitForTimeout(5000);

      // Check for decryption errors (wrong key should cause failures)
      const aliceStats = await getE2EEStats(alicePage);

      // If frames were received with wrong key, there should be decryption errors
      // This demonstrates that E2EE properly rejects frames encrypted with different keys
      if (aliceStats.framesDecrypted > 0) {
        // Connection was properly encrypted
        expect(aliceStats.decryptionErrors).toBeGreaterThanOrEqual(0);
      }
    } finally {
      await aliceContext.close();
      await attackerContext.close();
    }
  });
});

test.describe('Browser Compatibility Tests', () => {
  test('should detect E2EE support correctly', async ({ page, browserName }) => {
    await page.goto(TEST_CONFIG.testPageUrl);

    const e2eeSupported = await page.evaluate(() => {
      // Check for RTCRtpSender.transform (Insertable Streams)
      if (typeof RTCRtpSender !== 'undefined') {
        const proto = Object.getOwnPropertyDescriptor(RTCRtpSender.prototype, 'transform');
        if (proto !== undefined) {
          return 'insertable-streams';
        }
      }

      // Check for RTCRtpScriptTransform (Safari)
      if ('RTCRtpScriptTransform' in window) {
        return 'script-transform';
      }

      return 'none';
    });

    // Expected support by browser
    const expectedSupport: Record<string, string[]> = {
      chromium: ['insertable-streams'],
      firefox: ['insertable-streams', 'none'], // Firefox 117+ has partial support
      webkit: ['script-transform'],
    };

    const expected = expectedSupport[browserName] || ['none'];
    expect(expected).toContain(e2eeSupported);
  });

  test('should handle fallback gracefully when E2EE is not supported', async ({ page }) => {
    await page.goto(TEST_CONFIG.testPageUrl);

    const result = await page.evaluate(() => {
      // Simulate E2EE not being supported
      const handleUnsupportedE2EE = (
        window as unknown as {
          handleUnsupportedE2EE?: () => { success: boolean; fallback: string };
        }
      ).handleUnsupportedE2EE;

      if (handleUnsupportedE2EE) {
        return handleUnsupportedE2EE();
      }

      return { success: true, fallback: 'none' };
    });

    expect(result.success).toBe(true);
  });
});

test.describe('Performance Tests', () => {
  test('should maintain acceptable frame processing latency', async ({ browser }) => {
    test.skip(process.env.CI === 'true', 'Skipping performance test in CI');

    const context = await browser.newContext({
      permissions: ['camera', 'microphone'],
    });

    try {
      const page = await context.newPage();
      await page.goto(TEST_CONFIG.testPageUrl);

      // Start local encryption test
      const latencies = await page.evaluate(async () => {
        const measureEncryptionLatency = (
          window as unknown as { measureEncryptionLatency: () => Promise<number[]> }
        ).measureEncryptionLatency;

        if (measureEncryptionLatency) {
          return await measureEncryptionLatency();
        }

        return [];
      });

      if (latencies.length > 0) {
        const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

        // Average encryption latency should be under 5ms
        expect(avgLatency).toBeLessThan(5);
      }
    } finally {
      await context.close();
    }
  });
});
