/**
 * @module types
 * Core type definitions for the E2EE WebRTC library
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Deployment mode for the E2EE client
 */
export type DeploymentMode = 'self-hosted' | 'managed' | 'hybrid';

/**
 * Post-quantum cryptography options
 */
export interface PostQuantumConfig {
  /** Enable post-quantum hybrid encryption (Kyber + ECDH) */
  enabled: boolean;
  /** Kyber security level (512, 768, or 1024) */
  securityLevel?: 512 | 768 | 1024;
}

/**
 * Key rotation configuration
 */
export interface KeyRotationConfig {
  /** Enable automatic key rotation */
  enabled: boolean;
  /** Interval in milliseconds between key rotations */
  intervalMs: number;
  /** Number of previous keys to keep for decryption of in-flight frames */
  keyHistorySize: number;
}

/**
 * Security configuration options
 */
export interface SecurityConfig {
  /** Post-quantum encryption settings */
  postQuantum?: PostQuantumConfig;
  /** Key rotation settings */
  keyRotation?: KeyRotationConfig;
  /** Enable audit logging for compliance */
  auditLogging?: boolean;
  /** Data residency region for compliance */
  dataResidency?: 'EU' | 'US' | 'APAC' | 'custom';
  /** Enable replay attack protection */
  replayProtection?: boolean;
  /** Maximum frame sequence gap for replay protection */
  maxSequenceGap?: number;
}

/**
 * Signaling server configuration
 */
export interface SignalingConfig {
  /** WebSocket URL for signaling */
  url: string;
  /** Authentication method */
  auth?: 'jwt' | 'apikey' | 'none';
  /** Authentication token or API key */
  token?: string;
  /** Reconnection settings */
  reconnect?: {
    enabled: boolean;
    maxAttempts: number;
    delayMs: number;
  };
}

/**
 * SFU (Selective Forwarding Unit) configuration
 */
export interface SfuConfig {
  /** SFU server URL or 'managed' for our cloud service */
  url: string;
  /** Port range for media */
  portRange?: { min: number; max: number };
}

/**
 * TURN server configuration
 */
export interface TurnConfig {
  /** TURN server URLs or 'managed' for our cloud service */
  urls: string[];
  /** Use managed TURN service */
  managed?: boolean;
  /** TURN username */
  username?: string;
  /** TURN credential */
  credential?: string;
}

/**
 * Main E2EE client configuration
 */
export interface E2EEConfig {
  /** Deployment mode */
  mode: DeploymentMode;
  /** API key for managed mode */
  apiKey?: string;
  /** Region for managed mode */
  region?: string;
  /** Signaling server configuration */
  signaling?: SignalingConfig;
  /** SFU configuration */
  sfu?: SfuConfig;
  /** TURN server configuration */
  turn?: TurnConfig;
  /** Security settings */
  security?: SecurityConfig;
  /** Enable debug logging */
  debug?: boolean;
}

// ============================================================================
// Crypto Types
// ============================================================================

/**
 * Supported encryption algorithms
 */
export type EncryptionAlgorithm = 'AES-GCM-256' | 'AES-GCM-128' | 'ChaCha20-Poly1305';

/**
 * Supported key exchange algorithms
 */
export type KeyExchangeAlgorithm = 'ECDH-P256' | 'ECDH-P384' | 'X25519' | 'Kyber-ECDH';

/**
 * Key generation number (0-255)
 */
export type KeyGeneration = number;

/**
 * Encryption state for a participant
 */
export interface EncryptionState {
  /** Current encryption key */
  currentKey: CryptoKey | null;
  /** Current key generation */
  currentGeneration: KeyGeneration;
  /** Previous key for decrypting in-flight frames */
  previousKey: CryptoKey | null;
  /** Previous key generation */
  previousGeneration: KeyGeneration;
  /** Key history for multi-key support */
  keyHistory: Map<KeyGeneration, CryptoKey>;
  /** Whether encryption is active */
  isActive: boolean;
}

/**
 * Key exchange message types
 */
export type KeyExchangeMessageType = 'offer' | 'answer' | 'key-update' | 'key-ack';

/**
 * Key exchange message
 */
export interface KeyExchangeMessage {
  /** Message type */
  type: KeyExchangeMessageType;
  /** Sender participant ID */
  senderId: string;
  /** Recipient participant ID (null for broadcast) */
  recipientId: string | null;
  /** Public key bytes (base64 encoded) */
  publicKey: string;
  /** Key generation */
  generation: KeyGeneration;
  /** Signature for verification (base64 encoded) */
  signature?: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Encrypted frame format
 * [Generation (1 byte)][IV (12 bytes)][Ciphertext + AuthTag (16 bytes)]
 */
export interface EncryptedFrame {
  /** Key generation used for encryption */
  generation: KeyGeneration;
  /** Initialization vector (12 bytes for AES-GCM) */
  iv: Uint8Array;
  /** Encrypted data with authentication tag */
  ciphertext: Uint8Array;
}

// ============================================================================
// Browser Detection Types
// ============================================================================

/**
 * Supported E2EE methods based on browser capabilities
 */
export type E2EEMethod = 'insertable-streams' | 'script-transform' | 'none';

/**
 * Browser type
 */
export type BrowserType = 'chrome' | 'firefox' | 'safari' | 'edge' | 'unknown';

/**
 * Browser capabilities for E2EE
 */
export interface BrowserCapabilities {
  /** Detected browser type */
  browser: BrowserType;
  /** Browser version */
  version: string;
  /** Supported E2EE method */
  e2eeMethod: E2EEMethod;
  /** Supports Insertable Streams API */
  supportsInsertableStreams: boolean;
  /** Supports RTCRtpScriptTransform (Safari) */
  supportsScriptTransform: boolean;
  /** Supports Web Workers */
  supportsWorkers: boolean;
  /** Supports SharedArrayBuffer (for performance) */
  supportsSharedArrayBuffer: boolean;
  /** Supports WebAssembly (for post-quantum crypto) */
  supportsWasm: boolean;
}

// ============================================================================
// Participant & Session Types
// ============================================================================

/**
 * Participant role in the session
 */
export type ParticipantRole = 'host' | 'participant' | 'viewer';

/**
 * Participant information
 */
export interface Participant {
  /** Unique participant ID */
  id: string;
  /** Display name */
  displayName?: string;
  /** Role in the session */
  role: ParticipantRole;
  /** Encryption state */
  encryptionState: EncryptionState;
  /** Is local participant */
  isLocal: boolean;
  /** Connection state */
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'failed';
  /** Media streams */
  streams: {
    audio: boolean;
    video: boolean;
    screen: boolean;
  };
}

/**
 * Session topology
 */
export type SessionTopology = 'p2p' | 'mesh' | 'sfu';

/**
 * Session information
 */
export interface Session {
  /** Unique session ID */
  id: string;
  /** Session topology */
  topology: SessionTopology;
  /** All participants */
  participants: Map<string, Participant>;
  /** Local participant ID */
  localParticipantId: string;
  /** Session creation timestamp */
  createdAt: number;
  /** E2EE enabled */
  e2eeEnabled: boolean;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * E2EE event types
 */
export type E2EEEventType =
  | 'initialized'
  | 'key-generated'
  | 'key-exchanged'
  | 'key-rotated'
  | 'encryption-started'
  | 'encryption-stopped'
  | 'participant-joined'
  | 'participant-left'
  | 'participant-key-received'
  | 'error'
  | 'warning'
  | 'debug';

/**
 * Base event interface
 */
export interface E2EEEvent {
  /** Event type */
  type: E2EEEventType;
  /** Timestamp */
  timestamp: number;
  /** Event data */
  data?: unknown;
}

/**
 * Error event
 */
export interface E2EEErrorEvent extends E2EEEvent {
  type: 'error';
  data: {
    code: string;
    message: string;
    recoverable: boolean;
    details?: unknown;
  };
}

/**
 * Key event
 */
export interface E2EEKeyEvent extends E2EEEvent {
  type: 'key-generated' | 'key-exchanged' | 'key-rotated' | 'participant-key-received';
  data: {
    participantId: string;
    generation: KeyGeneration;
    fingerprint: string;
  };
}

/**
 * Event listener function
 */
export type E2EEEventListener<T extends E2EEEvent = E2EEEvent> = (event: T) => void;

// ============================================================================
// Worker Types
// ============================================================================

/**
 * Worker message types
 */
export type WorkerMessageType =
  | 'init'
  | 'set-key'
  | 'encrypt'
  | 'decrypt'
  | 'rotate-key'
  | 'stats'
  | 'error';

/**
 * Worker message base interface
 */
export interface WorkerMessage {
  /** Message type */
  type: WorkerMessageType;
  /** Message ID for request/response correlation */
  id?: string;
}

/**
 * Initialize worker message
 */
export interface WorkerInitMessage extends WorkerMessage {
  type: 'init';
  data: {
    participantId: string;
    isLocal: boolean;
  };
}

/**
 * Set key worker message
 */
export interface WorkerSetKeyMessage extends WorkerMessage {
  type: 'set-key';
  data: {
    key: CryptoKey;
    generation: KeyGeneration;
    setPrevious?: boolean;
  };
}

/**
 * Worker statistics
 */
export interface WorkerStats {
  /** Frames encrypted */
  framesEncrypted: number;
  /** Frames decrypted */
  framesDecrypted: number;
  /** Encryption errors */
  encryptionErrors: number;
  /** Decryption errors */
  decryptionErrors: number;
  /** Average encryption time (ms) */
  avgEncryptionTimeMs: number;
  /** Average decryption time (ms) */
  avgDecryptionTimeMs: number;
  /** Current key generation */
  currentGeneration: KeyGeneration;
}

// ============================================================================
// SFU Types
// ============================================================================

/**
 * Sender key for group encryption
 */
export interface SenderKey {
  /** Participant ID */
  participantId: string;
  /** Encryption key */
  key: CryptoKey;
  /** Key generation */
  generation: KeyGeneration;
  /** Key creation timestamp */
  createdAt: number;
}

/**
 * SFU room information
 */
export interface SfuRoom {
  /** Room ID */
  id: string;
  /** Room name */
  name?: string;
  /** Maximum participants */
  maxParticipants: number;
  /** Current participant count */
  participantCount: number;
  /** Sender keys for all participants */
  senderKeys: Map<string, SenderKey>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * E2EE error codes
 */
export enum E2EEErrorCode {
  // Initialization errors
  BROWSER_NOT_SUPPORTED = 'BROWSER_NOT_SUPPORTED',
  WORKER_INIT_FAILED = 'WORKER_INIT_FAILED',
  CRYPTO_NOT_AVAILABLE = 'CRYPTO_NOT_AVAILABLE',

  // Key errors
  KEY_GENERATION_FAILED = 'KEY_GENERATION_FAILED',
  KEY_EXCHANGE_FAILED = 'KEY_EXCHANGE_FAILED',
  KEY_NOT_FOUND = 'KEY_NOT_FOUND',
  KEY_EXPIRED = 'KEY_EXPIRED',
  INVALID_KEY = 'INVALID_KEY',

  // Encryption/Decryption errors
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
  INVALID_FRAME = 'INVALID_FRAME',
  REPLAY_DETECTED = 'REPLAY_DETECTED',

  // Connection errors
  SIGNALING_ERROR = 'SIGNALING_ERROR',
  SFU_CONNECTION_FAILED = 'SFU_CONNECTION_FAILED',
  PEER_CONNECTION_FAILED = 'PEER_CONNECTION_FAILED',

  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
}

/**
 * Custom E2EE error class
 */
export class E2EEError extends Error {
  constructor(
    public readonly code: E2EEErrorCode,
    message: string,
    public readonly recoverable: boolean = false,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'E2EEError';
  }
}
