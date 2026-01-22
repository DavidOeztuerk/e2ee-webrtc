/**
 * @module client
 * E2EE WebRTC client components
 */

export {
  E2EEClient,
  type E2EEClientConfig,
  type E2EEClientState,
  type E2EEClientStats,
  type E2EEClientEventType,
  type E2EEClientEventMap,
  type E2EEParticipant,
} from './e2ee-client';

export {
  SignalingClient,
  type SignalingClientConfig,
  type SignalingConnectionState,
  type SignalingEventType,
  type SignalingEventMap,
  type SignalingParticipant,
  type JoinRoomOptions,
  type JoinRoomResult,
  type SDPDescription,
  type ICECandidateInfo,
  type KeyExchangePayload,
} from './signaling-client';

export {
  PeerManager,
  type PeerManagerConfig,
  type PeerManagerEventType,
  type PeerManagerEventMap,
  type PeerInfo,
  type IceServerConfig,
  type EncryptionTransform,
} from './peer-manager';
