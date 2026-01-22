/**
 * @module tests/unit/core/state-machine
 * Comprehensive unit tests for E2EE state machine
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  E2EEStateMachine,
  createE2EEStateMachine,
  type E2EEState,
  type E2EEEvent,
  type EncryptionStatus,
  type StateChangeListener,
} from '../../../src/core/state-machine';

describe('E2EEStateMachine', () => {
  let machine: E2EEStateMachine;

  beforeEach(() => {
    machine = new E2EEStateMachine();
  });

  // =========================================================================
  // Constructor Tests
  // =========================================================================
  describe('constructor', () => {
    it('should create with default config', () => {
      const m = new E2EEStateMachine();
      expect(m.currentState).toBe('idle');
    });

    it('should create with custom initial state', () => {
      const m = new E2EEStateMachine({ initialState: 'disconnected' });
      expect(m.currentState).toBe('disconnected');
    });

    it('should create with debug mode enabled', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const m = new E2EEStateMachine({ debug: true, participantId: 'test-user' });

      // Trigger a transition to verify debug logging
      m.transition('initialize');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should create with custom participant ID', () => {
      const m = new E2EEStateMachine({ participantId: 'custom-participant' });
      expect(m.toString()).toBe('E2EEStateMachine(idle)');
    });

    it('should initialize context with default values', () => {
      const ctx = machine.stateContext;
      expect(ctx.retryCount).toBe(0);
      expect(ctx.lastTransitionTime).toBeGreaterThan(0);
      expect(ctx.data).toEqual({});
    });
  });

  // =========================================================================
  // State Getter Tests
  // =========================================================================
  describe('currentState', () => {
    it('should return current state', () => {
      expect(machine.currentState).toBe('idle');

      machine.transition('initialize');
      expect(machine.currentState).toBe('initializing');
    });
  });

  describe('stateContext', () => {
    it('should return a copy of context', () => {
      const ctx1 = machine.stateContext;
      const ctx2 = machine.stateContext;

      expect(ctx1).not.toBe(ctx2);
      expect(ctx1).toEqual(ctx2);
    });
  });

  // =========================================================================
  // State Checker Tests
  // =========================================================================
  describe('is()', () => {
    it('should return true for matching state', () => {
      expect(machine.is('idle')).toBe(true);
    });

    it('should return false for non-matching state', () => {
      expect(machine.is('connected')).toBe(false);
    });
  });

  describe('isAny()', () => {
    it('should return true if current state is in the list', () => {
      expect(machine.isAny('idle', 'connecting', 'disconnected')).toBe(true);
    });

    it('should return false if current state is not in the list', () => {
      expect(machine.isAny('connecting', 'encrypted', 'error')).toBe(false);
    });
  });

  describe('isEncrypted', () => {
    it('should return false when not encrypted', () => {
      expect(machine.isEncrypted).toBe(false);
    });

    it('should return true when encrypted', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      machine.transition('key-exchange-complete');
      machine.transition('encryption-active');

      expect(machine.isEncrypted).toBe(true);
    });
  });

  describe('isEncryptionActive', () => {
    it('should return false when not encrypting', () => {
      expect(machine.isEncryptionActive).toBe(false);
    });

    it('should return true when encrypting', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      machine.transition('key-exchange-complete');

      expect(machine.isEncryptionActive).toBe(true);
      expect(machine.currentState).toBe('encrypting');
    });

    it('should return true when encrypted', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      machine.transition('key-exchange-complete');
      machine.transition('encryption-active');

      expect(machine.isEncryptionActive).toBe(true);
    });
  });

  describe('isError', () => {
    it('should return false when not in error state', () => {
      expect(machine.isError).toBe(false);
    });

    it('should return true when in error state', () => {
      machine.transition('initialize');
      machine.transition('error');

      expect(machine.isError).toBe(true);
    });
  });

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      expect(machine.isConnected).toBe(false);
    });

    it('should return true when exchanging-keys', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');

      expect(machine.isConnected).toBe(true);
      expect(machine.currentState).toBe('exchanging-keys');
    });

    it('should return true when encrypting', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      machine.transition('key-exchange-complete');

      expect(machine.isConnected).toBe(true);
    });

    it('should return true when encrypted', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      machine.transition('key-exchange-complete');
      machine.transition('encryption-active');

      expect(machine.isConnected).toBe(true);
    });

    it('should return true when rekeying', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      machine.transition('key-exchange-complete');
      machine.transition('encryption-active');
      machine.transition('start-rekey');

      expect(machine.isConnected).toBe(true);
      expect(machine.currentState).toBe('rekeying');
    });
  });

  // =========================================================================
  // Transition Tests
  // =========================================================================
  describe('transition()', () => {
    it('should perform valid transitions', () => {
      expect(machine.transition('initialize')).toBe(true);
      expect(machine.currentState).toBe('initializing');
    });

    it('should reject invalid transitions', () => {
      expect(machine.transition('connected')).toBe(false);
      expect(machine.currentState).toBe('idle');
    });

    it('should update lastTransitionTime on transition', () => {
      const initialTime = machine.stateContext.lastTransitionTime;

      // Wait a tiny bit
      vi.useFakeTimers();
      vi.advanceTimersByTime(100);

      machine.transition('initialize');

      expect(machine.stateContext.lastTransitionTime).toBeGreaterThanOrEqual(initialTime);
      vi.useRealTimers();
    });

    it('should update context on error event', () => {
      machine.transition('initialize');
      machine.transition('error', { message: 'Test error', code: 'TEST_001' });

      const ctx = machine.stateContext;
      expect(ctx.errorMessage).toBe('Test error');
      expect(ctx.errorCode).toBe('TEST_001');
      expect(ctx.lastGoodState).toBe('initializing');
      expect(ctx.retryCount).toBe(1);
    });

    it('should increment retryCount on multiple errors', () => {
      // Go to connecting state first
      machine.transition('initialize');
      machine.transition('connect');

      // First error - must provide eventContext to increment retryCount
      machine.transition('error', { message: 'First error' });
      expect(machine.stateContext.retryCount).toBe(1);

      // Recover and go back to connecting
      machine.transition('recover');

      // Second error
      machine.transition('error', { message: 'Second error' });
      expect(machine.stateContext.retryCount).toBe(2);
    });

    it('should not increment retryCount when error event has no context', () => {
      machine.transition('initialize');
      machine.transition('error'); // No context

      expect(machine.stateContext.retryCount).toBe(0);
    });

    it('should clear error context on recover', () => {
      machine.transition('initialize');
      machine.transition('error', { message: 'Error!', code: 'ERR' });
      machine.transition('recover');

      const ctx = machine.stateContext;
      expect(ctx.errorMessage).toBeUndefined();
      expect(ctx.errorCode).toBeUndefined();
    });

    it('should reset context on reset event', () => {
      machine.transition('initialize');
      machine.transition('error', { message: 'Error!' });
      machine.setContextData('test', 'value');
      machine.transition('reset');

      const ctx = machine.stateContext;
      expect(ctx.errorMessage).toBeUndefined();
      expect(ctx.errorCode).toBeUndefined();
      expect(ctx.retryCount).toBe(0);
      expect(ctx.lastGoodState).toBeUndefined();
      expect(ctx.data).toEqual({});
    });

    it('should notify listeners on transition', () => {
      const listener = vi.fn();
      machine.addListener(listener);

      machine.transition('initialize');

      expect(listener).toHaveBeenCalledWith('initializing', 'idle', 'initialize', undefined);
    });

    it('should pass event context to listeners', () => {
      const listener = vi.fn();
      machine.addListener(listener);

      machine.transition('initialize');
      machine.transition('error', { message: 'Test' });

      expect(listener).toHaveBeenLastCalledWith('error', 'initializing', 'error', {
        message: 'Test',
      });
    });

    it('should handle listener errors gracefully', () => {
      const badListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const goodListener = vi.fn();

      machine.addListener(badListener);
      machine.addListener(goodListener);

      // Should not throw, and should still call good listener
      expect(() => machine.transition('initialize')).not.toThrow();
      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });

    it('should log invalid transitions in debug mode', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const m = new E2EEStateMachine({ debug: true });

      m.transition('connected'); // Invalid from idle

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[E2EEStateMachine'),
        expect.stringContaining('Invalid transition')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('tryTransition()', () => {
    it('should return true for valid transitions', () => {
      expect(machine.tryTransition('initialize')).toBe(true);
      expect(machine.currentState).toBe('initializing');
    });

    it('should return false for invalid transitions without throwing', () => {
      expect(machine.tryTransition('connected')).toBe(false);
      expect(machine.currentState).toBe('idle');
    });

    it('should pass context to transition', () => {
      machine.transition('initialize');
      machine.tryTransition('error', { message: 'Try error' });

      expect(machine.stateContext.errorMessage).toBe('Try error');
    });
  });

  describe('canTransition()', () => {
    it('should return true for valid events', () => {
      expect(machine.canTransition('initialize')).toBe(true);
      expect(machine.canTransition('reset')).toBe(true);
    });

    it('should return false for invalid events', () => {
      expect(machine.canTransition('connected')).toBe(false);
      expect(machine.canTransition('encryption-active')).toBe(false);
    });
  });

  describe('getValidEvents()', () => {
    it('should return valid events for idle state', () => {
      const events = machine.getValidEvents();

      expect(events).toContain('initialize');
      expect(events).toContain('reset');
      expect(events).not.toContain('connected');
    });

    it('should return valid events for encrypted state', () => {
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      machine.transition('key-exchange-complete');
      machine.transition('encryption-active');

      const events = machine.getValidEvents();

      expect(events).toContain('start-key-exchange');
      expect(events).toContain('start-rekey');
      expect(events).toContain('error');
      expect(events).toContain('disconnect');
      expect(events).toContain('reset');
    });

    it('should return valid events for error state', () => {
      machine.transition('initialize');
      machine.transition('error');

      const events = machine.getValidEvents();

      expect(events).toContain('recover');
      expect(events).toContain('disconnect');
      expect(events).toContain('reset');
    });
  });

  // =========================================================================
  // Context Data Tests
  // =========================================================================
  describe('setContextData()', () => {
    it('should set context data', () => {
      machine.setContextData('key1', 'value1');
      machine.setContextData('key2', { nested: true });

      expect(machine.stateContext.data).toEqual({
        key1: 'value1',
        key2: { nested: true },
      });
    });

    it('should overwrite existing data', () => {
      machine.setContextData('key', 'original');
      machine.setContextData('key', 'updated');

      expect(machine.stateContext.data.key).toBe('updated');
    });
  });

  describe('getContextData()', () => {
    it('should return context data', () => {
      machine.setContextData('myKey', 123);

      expect(machine.getContextData<number>('myKey')).toBe(123);
    });

    it('should return undefined for missing keys', () => {
      expect(machine.getContextData('nonexistent')).toBeUndefined();
    });

    it('should preserve type information', () => {
      interface CustomData {
        name: string;
        count: number;
      }

      const data: CustomData = { name: 'test', count: 42 };
      machine.setContextData('custom', data);

      const retrieved = machine.getContextData<CustomData>('custom');
      expect(retrieved?.name).toBe('test');
      expect(retrieved?.count).toBe(42);
    });
  });

  // =========================================================================
  // Listener Tests
  // =========================================================================
  describe('addListener()', () => {
    it('should add listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      machine.addListener(listener1);
      machine.addListener(listener2);

      machine.transition('initialize');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('should not add duplicate listeners', () => {
      const listener = vi.fn();

      machine.addListener(listener);
      machine.addListener(listener);

      machine.transition('initialize');

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeListener()', () => {
    it('should remove listeners', () => {
      const listener = vi.fn();

      machine.addListener(listener);
      machine.removeListener(listener);

      machine.transition('initialize');

      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle removing non-existent listener', () => {
      const listener = vi.fn();

      // Should not throw
      expect(() => machine.removeListener(listener)).not.toThrow();
    });
  });

  // =========================================================================
  // Reset Tests
  // =========================================================================
  describe('reset()', () => {
    it('should reset to idle state', () => {
      machine.transition('initialize');
      machine.transition('connect');

      machine.reset();

      expect(machine.currentState).toBe('idle');
    });

    it('should work from any state', () => {
      // Test from various states
      const states: E2EEState[] = [
        'idle',
        'initializing',
        'connecting',
        'exchanging-keys',
        'encrypting',
        'encrypted',
        'rekeying',
        'error',
        'disconnected',
      ];

      for (const startState of states) {
        const m = new E2EEStateMachine({ initialState: startState });
        m.reset();
        expect(m.currentState).toBe('idle');
      }
    });
  });

  // =========================================================================
  // toEncryptionState Tests
  // =========================================================================
  describe('toEncryptionState()', () => {
    const stateToStatusMap: Array<[E2EEState, EncryptionStatus]> = [
      ['idle', 'none'],
      ['initializing', 'none'],
      ['connecting', 'negotiating'],
      ['exchanging-keys', 'negotiating'],
      ['encrypting', 'active'],
      ['encrypted', 'active'],
      ['rekeying', 'rekeying'],
      ['error', 'failed'],
      ['disconnected', 'none'],
    ];

    for (const [state, expectedStatus] of stateToStatusMap) {
      it(`should return '${expectedStatus}' for '${state}' state`, () => {
        const m = new E2EEStateMachine({ initialState: state });
        expect(m.toEncryptionState()).toBe(expectedStatus);
      });
    }
  });

  // =========================================================================
  // toString Tests
  // =========================================================================
  describe('toString()', () => {
    it('should return string representation', () => {
      expect(machine.toString()).toBe('E2EEStateMachine(idle)');
    });

    it('should update with state changes', () => {
      machine.transition('initialize');
      expect(machine.toString()).toBe('E2EEStateMachine(initializing)');
    });
  });

  // =========================================================================
  // Complete Workflow Tests
  // =========================================================================
  describe('complete workflows', () => {
    it('should handle full connection lifecycle', () => {
      // Initialize
      expect(machine.transition('initialize')).toBe(true);
      expect(machine.currentState).toBe('initializing');

      // Connect
      expect(machine.transition('connect')).toBe(true);
      expect(machine.currentState).toBe('connecting');

      // Connected (moves to key exchange)
      expect(machine.transition('connected')).toBe(true);
      expect(machine.currentState).toBe('exchanging-keys');

      // Key exchange complete
      expect(machine.transition('key-exchange-complete')).toBe(true);
      expect(machine.currentState).toBe('encrypting');

      // Encryption active
      expect(machine.transition('encryption-active')).toBe(true);
      expect(machine.currentState).toBe('encrypted');
      expect(machine.isEncrypted).toBe(true);

      // Disconnect
      expect(machine.transition('disconnect')).toBe(true);
      expect(machine.currentState).toBe('disconnected');
    });

    it('should handle rekey cycle', () => {
      // Get to encrypted state
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      machine.transition('key-exchange-complete');
      machine.transition('encryption-active');

      // Start rekey
      expect(machine.transition('start-rekey')).toBe(true);
      expect(machine.currentState).toBe('rekeying');
      expect(machine.toEncryptionState()).toBe('rekeying');

      // Rekey complete
      expect(machine.transition('rekey-complete')).toBe(true);
      expect(machine.currentState).toBe('encrypted');
    });

    it('should handle error and recovery', () => {
      machine.transition('initialize');
      machine.transition('connect');

      // Error occurs
      machine.transition('error', { message: 'Connection lost' });
      expect(machine.currentState).toBe('error');
      expect(machine.toEncryptionState()).toBe('failed');

      // Recover
      machine.transition('recover');
      expect(machine.currentState).toBe('connecting');
      expect(machine.toEncryptionState()).toBe('negotiating');
    });

    it('should handle reconnection from disconnected', () => {
      // Get to disconnected
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      machine.transition('disconnect');
      expect(machine.currentState).toBe('disconnected');

      // Reconnect
      expect(machine.transition('connect')).toBe(true);
      expect(machine.currentState).toBe('connecting');
    });

    it('should handle key re-exchange from encrypted state', () => {
      // Get to encrypted
      machine.transition('initialize');
      machine.transition('connect');
      machine.transition('connected');
      machine.transition('key-exchange-complete');
      machine.transition('encryption-active');

      // Start new key exchange
      expect(machine.transition('start-key-exchange')).toBe(true);
      expect(machine.currentState).toBe('exchanging-keys');
    });
  });

  // =========================================================================
  // Debug Logging Tests
  // =========================================================================
  describe('debug logging', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should log transitions when debug is enabled', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const m = new E2EEStateMachine({ debug: true, participantId: 'debug-test' });

      m.transition('initialize');

      expect(consoleSpy).toHaveBeenCalledWith(
        '[E2EEStateMachine debug-test]',
        'Transition: idle -> initializing (initialize)'
      );
    });

    it('should not log when debug is disabled', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const m = new E2EEStateMachine({ debug: false });

      m.transition('initialize');

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should log listener errors in debug mode', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const m = new E2EEStateMachine({ debug: true });

      m.addListener(() => {
        throw new Error('Listener failed');
      });

      m.transition('initialize');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[E2EEStateMachine'),
        'Listener error:',
        expect.any(Error)
      );
    });
  });
});

describe('createE2EEStateMachine', () => {
  it('should create a new state machine', () => {
    const machine = createE2EEStateMachine();
    expect(machine).toBeInstanceOf(E2EEStateMachine);
    expect(machine.currentState).toBe('idle');
  });

  it('should accept config options', () => {
    const machine = createE2EEStateMachine({
      initialState: 'disconnected',
      debug: false,
    });
    expect(machine.currentState).toBe('disconnected');
  });
});
