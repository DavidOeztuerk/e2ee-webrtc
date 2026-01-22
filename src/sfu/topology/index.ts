/**
 * @module sfu/topology
 * SFU topology management and key distribution strategies
 *
 * @description
 * Defines how participants connect and exchange keys in different
 * SFU configurations.
 */

import type { SessionTopology } from '../../types';

/**
 * Key distribution strategy
 */
export type KeyDistributionStrategy =
  | 'broadcast' // Send key to all participants
  | 'server-relay' // Send key through SFU server
  | 'mesh-backup'; // Use mesh for key exchange, SFU for media

/**
 * Topology configuration
 */
export interface TopologyConfig {
  /** Topology type */
  type: SessionTopology;
  /** Key distribution strategy */
  keyDistribution: KeyDistributionStrategy;
  /** Whether server can see key material (must be false for E2EE) */
  serverCanAccessKeys: false;
  /** Maximum hops for key distribution */
  maxKeyDistributionHops: number;
}

/**
 * Participant connection info in the topology
 */
export interface TopologyNode {
  /** Participant ID */
  participantId: string;
  /** Direct connections to other participants for key exchange */
  keyConnections: string[];
  /** Media routing through SFU */
  sfuConnected: boolean;
  /** Latency to SFU (ms) */
  sfuLatency?: number;
}

/**
 * Default topology configurations
 */
export const TOPOLOGY_CONFIGS: Record<SessionTopology, TopologyConfig> = {
  p2p: {
    type: 'p2p',
    keyDistribution: 'broadcast',
    serverCanAccessKeys: false,
    maxKeyDistributionHops: 1,
  },
  mesh: {
    type: 'mesh',
    keyDistribution: 'broadcast',
    serverCanAccessKeys: false,
    maxKeyDistributionHops: 1,
  },
  star: {
    type: 'star',
    keyDistribution: 'server-relay',
    serverCanAccessKeys: false,
    maxKeyDistributionHops: 2,
  },
  sfu: {
    type: 'sfu',
    keyDistribution: 'server-relay',
    serverCanAccessKeys: false,
    maxKeyDistributionHops: 2,
  },
};

/**
 * Manages the topology and key distribution for an SFU room
 */
export class TopologyManager {
  private readonly config: TopologyConfig;
  private nodes: Map<string, TopologyNode> = new Map();
  private localParticipantId: string;

  constructor(
    localParticipantId: string,
    topology: SessionTopology = 'sfu',
    customConfig?: Partial<TopologyConfig>
  ) {
    this.localParticipantId = localParticipantId;
    this.config = {
      ...TOPOLOGY_CONFIGS[topology],
      ...customConfig,
    };
  }

  /**
   * Gets the current topology type
   */
  get topologyType(): SessionTopology {
    return this.config.type;
  }

  /**
   * Gets the key distribution strategy
   */
  get keyDistributionStrategy(): KeyDistributionStrategy {
    return this.config.keyDistribution;
  }

  /**
   * Adds a participant to the topology
   */
  addNode(participantId: string): TopologyNode {
    const existingNode = this.nodes.get(participantId);
    if (existingNode !== undefined) {
      return existingNode;
    }

    const node: TopologyNode = {
      participantId,
      keyConnections: this.calculateKeyConnections(participantId),
      sfuConnected: false,
    };

    this.nodes.set(participantId, node);

    // Update key connections for all nodes in mesh topology
    if (this.config.type === 'mesh') {
      this.updateAllKeyConnections();
    }

    return node;
  }

  /**
   * Removes a participant from the topology
   */
  removeNode(participantId: string): boolean {
    const removed = this.nodes.delete(participantId);

    if (removed && this.config.type === 'mesh') {
      this.updateAllKeyConnections();
    }

    return removed;
  }

  /**
   * Gets a node by participant ID
   */
  getNode(participantId: string): TopologyNode | undefined {
    return this.nodes.get(participantId);
  }

  /**
   * Gets all nodes
   */
  getAllNodes(): TopologyNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Updates SFU connection state for a participant
   */
  updateSfuConnection(participantId: string, connected: boolean, latency?: number): void {
    const node = this.nodes.get(participantId);
    if (node !== undefined) {
      node.sfuConnected = connected;
      if (latency !== undefined) {
        node.sfuLatency = latency;
      }
    }
  }

  /**
   * Gets the participants that should receive a key from the given participant
   */
  getKeyDistributionTargets(fromParticipantId: string): string[] {
    switch (this.config.keyDistribution) {
      case 'broadcast':
        // Send to all other participants directly
        return Array.from(this.nodes.keys()).filter((id) => id !== fromParticipantId);

      case 'server-relay':
        // Key goes through server, server distributes to all
        // Return empty as the server handles distribution
        return [];

      case 'mesh-backup':
        // Direct connections for key exchange
        return this.nodes.get(fromParticipantId)?.keyConnections ?? [];

      default:
        return [];
    }
  }

  /**
   * Checks if key distribution should go through the server
   */
  shouldUseServerForKeyDistribution(): boolean {
    return this.config.keyDistribution === 'server-relay';
  }

  /**
   * Gets the optimal path for key distribution
   */
  getKeyDistributionPath(fromParticipantId: string, toParticipantId: string): string[] {
    if (fromParticipantId === toParticipantId) {
      return [];
    }

    switch (this.config.keyDistribution) {
      case 'broadcast':
      case 'mesh-backup':
        // Direct path
        return [fromParticipantId, toParticipantId];

      case 'server-relay':
        // Path through server
        return [fromParticipantId, 'server', toParticipantId];

      default:
        return [fromParticipantId, toParticipantId];
    }
  }

  /**
   * Validates the topology configuration for E2EE
   */
  validateForE2EE(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Server must never access keys
    if (this.config.serverCanAccessKeys) {
      errors.push('Server access to keys must be disabled for E2EE');
    }

    // Check all participants have key connections
    for (const [id, node] of this.nodes) {
      if (id !== this.localParticipantId && !node.sfuConnected) {
        if (node.keyConnections.length === 0 && this.config.keyDistribution !== 'server-relay') {
          errors.push(`Participant ${id} has no key distribution path`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Gets topology statistics
   */
  getStats(): {
    nodeCount: number;
    connectedNodes: number;
    averageLatency: number | null;
    topologyType: SessionTopology;
  } {
    const nodes = this.getAllNodes();
    const connectedNodes = nodes.filter((n) => n.sfuConnected).length;

    const latencies = nodes.filter((n) => n.sfuLatency !== undefined).map((n) => n.sfuLatency!);
    const averageLatency =
      latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

    return {
      nodeCount: nodes.length,
      connectedNodes,
      averageLatency,
      topologyType: this.config.type,
    };
  }

  /**
   * Clears all nodes
   */
  clear(): void {
    this.nodes.clear();
  }

  private calculateKeyConnections(participantId: string): string[] {
    switch (this.config.type) {
      case 'mesh':
        // Connect to all other participants
        return Array.from(this.nodes.keys()).filter((id) => id !== participantId);

      case 'star':
      case 'sfu':
        // Keys distributed through server
        return [];

      default:
        return [];
    }
  }

  private updateAllKeyConnections(): void {
    for (const [id, node] of this.nodes) {
      node.keyConnections = this.calculateKeyConnections(id);
    }
  }
}
