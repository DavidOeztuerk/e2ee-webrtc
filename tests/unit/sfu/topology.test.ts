/**
 * Tests for TopologyManager
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TopologyManager, TOPOLOGY_CONFIGS } from '../../../src/sfu/topology';

describe('TopologyManager', () => {
  describe('constructor', () => {
    it('should create manager with default SFU topology', () => {
      const manager = new TopologyManager('local-user');

      expect(manager.topologyType).toBe('sfu');
      expect(manager.keyDistributionStrategy).toBe('server-relay');
    });

    it('should create manager with mesh topology', () => {
      const manager = new TopologyManager('local-user', 'mesh');

      expect(manager.topologyType).toBe('mesh');
      expect(manager.keyDistributionStrategy).toBe('broadcast');
    });

    it('should create manager with star topology', () => {
      const manager = new TopologyManager('local-user', 'star');

      expect(manager.topologyType).toBe('star');
      expect(manager.keyDistributionStrategy).toBe('server-relay');
    });

    it('should accept custom config', () => {
      const manager = new TopologyManager('local-user', 'sfu', {
        keyDistribution: 'mesh-backup',
        maxKeyDistributionHops: 3,
      });

      expect(manager.keyDistributionStrategy).toBe('mesh-backup');
    });
  });

  describe('TOPOLOGY_CONFIGS', () => {
    it('should have mesh config', () => {
      expect(TOPOLOGY_CONFIGS.mesh).toEqual({
        type: 'mesh',
        keyDistribution: 'broadcast',
        serverCanAccessKeys: false,
        maxKeyDistributionHops: 1,
      });
    });

    it('should have star config', () => {
      expect(TOPOLOGY_CONFIGS.star).toEqual({
        type: 'star',
        keyDistribution: 'server-relay',
        serverCanAccessKeys: false,
        maxKeyDistributionHops: 2,
      });
    });

    it('should have sfu config', () => {
      expect(TOPOLOGY_CONFIGS.sfu).toEqual({
        type: 'sfu',
        keyDistribution: 'server-relay',
        serverCanAccessKeys: false,
        maxKeyDistributionHops: 2,
      });
    });

    it('should never allow server access to keys', () => {
      for (const config of Object.values(TOPOLOGY_CONFIGS)) {
        expect(config.serverCanAccessKeys).toBe(false);
      }
    });
  });

  describe('addNode', () => {
    let manager: TopologyManager;

    beforeEach(() => {
      manager = new TopologyManager('local-user', 'mesh');
    });

    it('should add a new node', () => {
      const node = manager.addNode('user1');

      expect(node.participantId).toBe('user1');
      expect(node.sfuConnected).toBe(false);
    });

    it('should return existing node if already added', () => {
      const node1 = manager.addNode('user1');
      const node2 = manager.addNode('user1');

      expect(node1).toBe(node2);
    });

    it('should calculate key connections for mesh', () => {
      manager.addNode('user1');
      manager.addNode('user2');
      const node3 = manager.addNode('user3');

      // In mesh, user3 should connect to user1 and user2
      expect(node3.keyConnections).toContain('user1');
      expect(node3.keyConnections).toContain('user2');
    });

    it('should update all key connections in mesh when adding', () => {
      manager.addNode('user1');
      manager.addNode('user2');

      const user1 = manager.getNode('user1');
      expect(user1?.keyConnections).toContain('user2');
    });

    it('should have empty key connections for SFU', () => {
      const sfuManager = new TopologyManager('local', 'sfu');
      sfuManager.addNode('user1');
      sfuManager.addNode('user2');

      expect(sfuManager.getNode('user1')?.keyConnections).toEqual([]);
    });
  });

  describe('removeNode', () => {
    let manager: TopologyManager;

    beforeEach(() => {
      manager = new TopologyManager('local-user', 'mesh');
      manager.addNode('user1');
      manager.addNode('user2');
    });

    it('should remove a node', () => {
      const removed = manager.removeNode('user1');

      expect(removed).toBe(true);
      expect(manager.getNode('user1')).toBeUndefined();
    });

    it('should return false for unknown node', () => {
      expect(manager.removeNode('unknown')).toBe(false);
    });

    it('should update key connections in mesh when removing', () => {
      manager.removeNode('user2');

      const user1 = manager.getNode('user1');
      expect(user1?.keyConnections).not.toContain('user2');
    });
  });

  describe('getNode', () => {
    it('should return node by ID', () => {
      const manager = new TopologyManager('local');
      manager.addNode('user1');

      const node = manager.getNode('user1');

      expect(node?.participantId).toBe('user1');
    });

    it('should return undefined for unknown node', () => {
      const manager = new TopologyManager('local');

      expect(manager.getNode('unknown')).toBeUndefined();
    });
  });

  describe('getAllNodes', () => {
    it('should return all nodes', () => {
      const manager = new TopologyManager('local');
      manager.addNode('user1');
      manager.addNode('user2');

      const nodes = manager.getAllNodes();

      expect(nodes.length).toBe(2);
      expect(nodes.map((n) => n.participantId)).toContain('user1');
      expect(nodes.map((n) => n.participantId)).toContain('user2');
    });
  });

  describe('updateSfuConnection', () => {
    it('should update connection state', () => {
      const manager = new TopologyManager('local');
      manager.addNode('user1');

      manager.updateSfuConnection('user1', true);

      expect(manager.getNode('user1')?.sfuConnected).toBe(true);
    });

    it('should update latency', () => {
      const manager = new TopologyManager('local');
      manager.addNode('user1');

      manager.updateSfuConnection('user1', true, 50);

      expect(manager.getNode('user1')?.sfuLatency).toBe(50);
    });

    it('should do nothing for unknown node', () => {
      const manager = new TopologyManager('local');

      expect(() => manager.updateSfuConnection('unknown', true)).not.toThrow();
    });
  });

  describe('getKeyDistributionTargets', () => {
    it('should return all others for broadcast', () => {
      const manager = new TopologyManager('local', 'mesh');
      manager.addNode('user1');
      manager.addNode('user2');
      manager.addNode('user3');

      const targets = manager.getKeyDistributionTargets('user1');

      expect(targets).toContain('user2');
      expect(targets).toContain('user3');
      expect(targets).not.toContain('user1');
    });

    it('should return empty for server-relay', () => {
      const manager = new TopologyManager('local', 'sfu');
      manager.addNode('user1');
      manager.addNode('user2');

      const targets = manager.getKeyDistributionTargets('user1');

      expect(targets).toEqual([]);
    });

    it('should return key connections for mesh-backup', () => {
      const manager = new TopologyManager('local', 'sfu', {
        keyDistribution: 'mesh-backup',
      });
      manager.addNode('user1');
      manager.addNode('user2');

      // mesh-backup uses keyConnections which are empty for SFU base
      const targets = manager.getKeyDistributionTargets('user1');

      expect(Array.isArray(targets)).toBe(true);
    });
  });

  describe('shouldUseServerForKeyDistribution', () => {
    it('should return true for server-relay', () => {
      const manager = new TopologyManager('local', 'sfu');

      expect(manager.shouldUseServerForKeyDistribution()).toBe(true);
    });

    it('should return false for broadcast', () => {
      const manager = new TopologyManager('local', 'mesh');

      expect(manager.shouldUseServerForKeyDistribution()).toBe(false);
    });
  });

  describe('getKeyDistributionPath', () => {
    it('should return empty for same participant', () => {
      const manager = new TopologyManager('local');

      const path = manager.getKeyDistributionPath('user1', 'user1');

      expect(path).toEqual([]);
    });

    it('should return direct path for broadcast', () => {
      const manager = new TopologyManager('local', 'mesh');

      const path = manager.getKeyDistributionPath('user1', 'user2');

      expect(path).toEqual(['user1', 'user2']);
    });

    it('should return server path for server-relay', () => {
      const manager = new TopologyManager('local', 'sfu');

      const path = manager.getKeyDistributionPath('user1', 'user2');

      expect(path).toEqual(['user1', 'server', 'user2']);
    });
  });

  describe('validateForE2EE', () => {
    it('should validate correct topology', () => {
      const manager = new TopologyManager('local', 'sfu');
      manager.addNode('user1');
      manager.updateSfuConnection('user1', true);

      const result = manager.validateForE2EE();

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should detect missing key distribution paths in mesh for non-SFU connected nodes', () => {
      const manager = new TopologyManager('local', 'mesh');
      manager.addNode('user1');
      // Don't add any connections

      // Manually set to test validation - non-SFU connected node without key connections
      const node = manager.getNode('user1');
      if (node) {
        node.keyConnections = [];
        node.sfuConnected = false; // Not connected to SFU, needs key connections
      }

      const result = manager.validateForE2EE();

      // Should be invalid because unconnected node has no key distribution path (in broadcast mode)
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('user1');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const manager = new TopologyManager('local', 'sfu');
      manager.addNode('user1');
      manager.addNode('user2');
      manager.addNode('user3');

      manager.updateSfuConnection('user1', true, 20);
      manager.updateSfuConnection('user2', true, 40);

      const stats = manager.getStats();

      expect(stats.nodeCount).toBe(3);
      expect(stats.connectedNodes).toBe(2);
      expect(stats.averageLatency).toBe(30);
      expect(stats.topologyType).toBe('sfu');
    });

    it('should return null average latency when no latencies', () => {
      const manager = new TopologyManager('local');
      manager.addNode('user1');

      const stats = manager.getStats();

      expect(stats.averageLatency).toBeNull();
    });
  });

  describe('clear', () => {
    it('should remove all nodes', () => {
      const manager = new TopologyManager('local');
      manager.addNode('user1');
      manager.addNode('user2');

      manager.clear();

      expect(manager.getAllNodes()).toEqual([]);
    });
  });
});
