/**
 * @module sfu
 * SFU (Selective Forwarding Unit) support for multi-party E2EE calls
 *
 * @description
 * This module provides the infrastructure for end-to-end encrypted
 * multi-party video calls using an SFU architecture.
 *
 * Key concepts:
 * - **Sender Keys**: Each participant has their own encryption key
 * - **Participant Manager**: Tracks all participants in a room
 * - **Topology Manager**: Handles key distribution strategies
 *
 * @example
 * ```typescript
 * import { SenderKeyManager, ParticipantManager, TopologyManager } from '@aspect/e2ee-webrtc/sfu';
 *
 * // Create managers
 * const keyManager = new SenderKeyManager({ participantId: 'user123' });
 * const participants = new ParticipantManager({ localParticipantId: 'user123' });
 * const topology = new TopologyManager('user123', 'sfu');
 *
 * // Generate local key
 * await keyManager.generateLocalKey();
 *
 * // Export key for distribution
 * const serializedKey = await keyManager.exportLocalKey();
 *
 * // Send to other participants via signaling...
 *
 * // When receiving a key from another participant
 * await keyManager.importRemoteKey(receivedKey);
 * participants.updateKeyState(receivedKey.participantId, receivedKey.generation);
 * ```
 *
 * @packageDocumentation
 */

// Sender Keys
export {
  SenderKeyManager,
  type SenderKeyManagerConfig,
  type SenderKeyEventType,
  type SenderKeyEventData,
  type SerializedSenderKey,
} from './sender-keys';

// Participant Manager
export {
  ParticipantManager,
  type ParticipantInfo,
  type ParticipantManagerConfig,
  type ParticipantEventType,
  type ParticipantEventData,
} from './participant-manager';

// Topology
export {
  TopologyManager,
  TOPOLOGY_CONFIGS,
  type TopologyConfig,
  type TopologyNode,
  type KeyDistributionStrategy,
} from './topology';
