/**
 * @module core/state-machine
 * E2EE session state management
 *
 * @description
 * Manages the lifecycle of an E2EE session including:
 * - Connection state transitions
 * - Key exchange states
 * - Error handling and recovery
 */

import type { EncryptionState } from '../../types';

/**
 * E2EE session states
 */
export type E2EEState =
  | 'idle'
  | 'initializing'
  | 'connecting'
  | 'exchanging-keys'
  | 'encrypting'
  | 'encrypted'
  | 'rekeying'
  | 'error'
  | 'disconnected';

/**
 * State transition events
 */
export type E2EEEvent =
  | 'initialize'
  | 'connect'
  | 'connected'
  | 'start-key-exchange'
  | 'key-exchange-complete'
  | 'start-encryption'
  | 'encryption-active'
  | 'start-rekey'
  | 'rekey-complete'
  | 'error'
  | 'recover'
  | 'disconnect'
  | 'reset';

/**
 * State transition definition
 */
interface StateTransition {
  from: E2EEState | E2EEState[];
  to: E2EEState;
  event: E2EEEvent;
}

/**
 * Valid state transitions
 */
const TRANSITIONS: StateTransition[] = [
  // Initialization
  { from: 'idle', to: 'initializing', event: 'initialize' },
  { from: 'initializing', to: 'connecting', event: 'connect' },
  { from: 'disconnected', to: 'connecting', event: 'connect' },

  // Connection
  { from: 'connecting', to: 'exchanging-keys', event: 'connected' },

  // Key exchange
  { from: 'exchanging-keys', to: 'encrypting', event: 'key-exchange-complete' },
  { from: ['encrypted', 'encrypting'], to: 'exchanging-keys', event: 'start-key-exchange' },

  // Encryption
  { from: 'encrypting', to: 'encrypted', event: 'encryption-active' },

  // Rekeying
  { from: 'encrypted', to: 'rekeying', event: 'start-rekey' },
  { from: 'rekeying', to: 'encrypted', event: 'rekey-complete' },

  // Error handling
  { from: ['initializing', 'connecting', 'exchanging-keys', 'encrypting', 'encrypted', 'rekeying'], to: 'error', event: 'error' },
  { from: 'error', to: 'connecting', event: 'recover' },

  // Disconnection
  { from: ['connecting', 'exchanging-keys', 'encrypting', 'encrypted', 'rekeying', 'error'], to: 'disconnected', event: 'disconnect' },

  // Reset
  { from: ['idle', 'initializing', 'connecting', 'exchanging-keys', 'encrypting', 'encrypted', 'rekeying', 'error', 'disconnected'], to: 'idle', event: 'reset' },
];

/**
 * State change listener
 */
export type StateChangeListener = (
  newState: E2EEState,
  oldState: E2EEState,
  event: E2EEEvent,
  context?: unknown
) => void;

/**
 * State machine configuration
 */
export interface StateMachineConfig {
  /** Initial state */
  initialState?: E2EEState;
  /** Enable debug logging */
  debug?: boolean;
  /** Participant ID for logging */
  participantId?: string;
}

/**
 * State context for additional state data
 */
export interface StateContext {
  /** Error message if in error state */
  errorMessage?: string;
  /** Error code if in error state */
  errorCode?: string;
  /** Number of retry attempts */
  retryCount: number;
  /** Last successful state before error */
  lastGoodState?: E2EEState;
  /** Timestamp of last state change */
  lastTransitionTime: number;
  /** Custom data */
  data: Record<string, unknown>;
}

/**
 * E2EE State Machine
 *
 * Manages state transitions for E2EE sessions with validation
 * and event-driven updates.
 */
export class E2EEStateMachine {
  private state: E2EEState;
  private context: StateContext;
  private listeners: Set<StateChangeListener> = new Set();
  private readonly config: Required<StateMachineConfig>;

  constructor(config: StateMachineConfig = {}) {
    this.config = {
      initialState: config.initialState ?? 'idle',
      debug: config.debug ?? false,
      participantId: config.participantId ?? 'unknown',
    };

    this.state = this.config.initialState;
    this.context = this.createInitialContext();
  }

  /**
   * Gets the current state
   */
  get currentState(): E2EEState {
    return this.state;
  }

  /**
   * Gets the state context
   */
  get stateContext(): Readonly<StateContext> {
    return { ...this.context };
  }

  /**
   * Checks if in a specific state
   */
  is(state: E2EEState): boolean {
    return this.state === state;
  }

  /**
   * Checks if in any of the specified states
   */
  isAny(...states: E2EEState[]): boolean {
    return states.includes(this.state);
  }

  /**
   * Checks if currently encrypted
   */
  get isEncrypted(): boolean {
    return this.state === 'encrypted';
  }

  /**
   * Checks if encryption is active (encrypting or encrypted)
   */
  get isEncryptionActive(): boolean {
    return this.state === 'encrypting' || this.state === 'encrypted';
  }

  /**
   * Checks if in an error state
   */
  get isError(): boolean {
    return this.state === 'error';
  }

  /**
   * Checks if connected (any state after connecting)
   */
  get isConnected(): boolean {
    return ['exchanging-keys', 'encrypting', 'encrypted', 'rekeying'].includes(this.state);
  }

  /**
   * Transitions to a new state via an event
   *
   * @param event - The event triggering the transition
   * @param eventContext - Optional context data for the transition
   * @returns true if transition was successful
   */
  transition(event: E2EEEvent, eventContext?: unknown): boolean {
    const transition = this.findTransition(event);

    if (transition === null) {
      this.log(`Invalid transition: ${event} from ${this.state}`);
      return false;
    }

    const oldState = this.state;
    this.state = transition.to;

    // Update context
    this.context.lastTransitionTime = Date.now();

    if (event === 'error' && eventContext !== undefined) {
      const errorCtx = eventContext as { message?: string; code?: string };
      this.context.errorMessage = errorCtx.message;
      this.context.errorCode = errorCtx.code;
      this.context.lastGoodState = oldState;
      this.context.retryCount++;
    }

    if (event === 'recover' || event === 'reset') {
      this.context.errorMessage = undefined;
      this.context.errorCode = undefined;
    }

    if (event === 'reset') {
      this.context.retryCount = 0;
      this.context.lastGoodState = undefined;
      this.context.data = {};
    }

    this.log(`Transition: ${oldState} -> ${this.state} (${event})`);

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(this.state, oldState, event, eventContext);
      } catch (error) {
        this.log('Listener error:', error);
      }
    }

    return true;
  }

  /**
   * Attempts a transition, returns false if invalid
   */
  tryTransition(event: E2EEEvent, eventContext?: unknown): boolean {
    if (!this.canTransition(event)) {
      return false;
    }
    return this.transition(event, eventContext);
  }

  /**
   * Checks if a transition is valid from current state
   */
  canTransition(event: E2EEEvent): boolean {
    return this.findTransition(event) !== null;
  }

  /**
   * Gets valid events from current state
   */
  getValidEvents(): E2EEEvent[] {
    const validEvents: E2EEEvent[] = [];

    for (const transition of TRANSITIONS) {
      const fromStates = Array.isArray(transition.from)
        ? transition.from
        : [transition.from];

      if (fromStates.includes(this.state)) {
        validEvents.push(transition.event);
      }
    }

    return validEvents;
  }

  /**
   * Sets context data
   */
  setContextData(key: string, value: unknown): void {
    this.context.data[key] = value;
  }

  /**
   * Gets context data
   */
  getContextData<T>(key: string): T | undefined {
    return this.context.data[key] as T | undefined;
  }

  /**
   * Adds a state change listener
   */
  addListener(listener: StateChangeListener): void {
    this.listeners.add(listener);
  }

  /**
   * Removes a state change listener
   */
  removeListener(listener: StateChangeListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Resets the state machine to initial state
   */
  reset(): void {
    this.transition('reset');
  }

  /**
   * Converts state to EncryptionState enum
   */
  toEncryptionState(): EncryptionState {
    switch (this.state) {
      case 'idle':
      case 'initializing':
        return 'none';
      case 'connecting':
      case 'exchanging-keys':
        return 'negotiating';
      case 'encrypting':
      case 'encrypted':
        return 'active';
      case 'rekeying':
        return 'rekeying';
      case 'error':
        return 'failed';
      case 'disconnected':
        return 'none';
      default:
        return 'none';
    }
  }

  /**
   * Gets a string representation of the current state
   */
  toString(): string {
    return `E2EEStateMachine(${this.state})`;
  }

  private findTransition(event: E2EEEvent): StateTransition | null {
    for (const transition of TRANSITIONS) {
      if (transition.event !== event) continue;

      const fromStates = Array.isArray(transition.from)
        ? transition.from
        : [transition.from];

      if (fromStates.includes(this.state)) {
        return transition;
      }
    }
    return null;
  }

  private createInitialContext(): StateContext {
    return {
      retryCount: 0,
      lastTransitionTime: Date.now(),
      data: {},
    };
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      // eslint-disable-next-line no-console
      console.log(`[E2EEStateMachine ${this.config.participantId}]`, ...args);
    }
  }
}

/**
 * Creates a state machine with common event handlers
 */
export function createE2EEStateMachine(config?: StateMachineConfig): E2EEStateMachine {
  return new E2EEStateMachine(config);
}
