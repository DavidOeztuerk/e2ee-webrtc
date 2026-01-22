/**
 * E2EE WebRTC Signaling Server
 *
 * Handles:
 * - WebSocket connections for real-time signaling
 * - Room management for multi-party calls
 * - WebRTC offer/answer exchange
 * - ICE candidate relay
 * - Encrypted key distribution (keys never decrypted server-side)
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';

// Logger
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

// Configuration
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const CORS_ORIGINS = process.env.CORS_ORIGINS ?? '*';

// Types
interface Participant {
  id: string;
  socket: WebSocket;
  roomId: string | null;
  displayName?: string;
  joinedAt: number;
}

interface Room {
  id: string;
  name?: string;
  participants: Map<string, Participant>;
  createdAt: number;
  maxParticipants: number;
}

interface SignalingMessage {
  type: string;
  roomId?: string;
  targetId?: string;
  senderId?: string;
  payload?: unknown;
}

// State
const participants = new Map<string, Participant>();
const rooms = new Map<string, Room>();

// HTTP Server for health checks
const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'healthy',
        participants: participants.size,
        rooms: rooms.size,
        uptime: process.uptime(),
      })
    );
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

// WebSocket Server
const wss = new WebSocketServer({
  server: httpServer,
  verifyClient: (info, cb) => {
    // CORS check
    const origin = info.origin ?? info.req.headers.origin;
    if (CORS_ORIGINS === '*' || CORS_ORIGINS.split(',').includes(origin ?? '')) {
      cb(true);
    } else {
      logger.warn({ origin }, 'CORS rejected');
      cb(false, 403, 'Forbidden');
    }
  },
});

// Message handlers
function handleJoinRoom(participant: Participant, message: SignalingMessage): void {
  const { roomId, payload } = message;
  if (!roomId) {
    sendError(participant, 'INVALID_MESSAGE', 'roomId is required');
    return;
  }

  // Leave current room if any
  if (participant.roomId) {
    handleLeaveRoom(participant);
  }

  // Get or create room
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      name: (payload as { roomName?: string })?.roomName,
      participants: new Map(),
      createdAt: Date.now(),
      maxParticipants: 50,
    };
    rooms.set(roomId, room);
    logger.info({ roomId }, 'Room created');
  }

  // Check capacity
  if (room.participants.size >= room.maxParticipants) {
    sendError(participant, 'ROOM_FULL', 'Room is at capacity');
    return;
  }

  // Join room
  participant.roomId = roomId;
  participant.displayName = (payload as { displayName?: string })?.displayName;
  room.participants.set(participant.id, participant);

  // Notify participant of successful join
  send(participant, {
    type: 'joined',
    roomId,
    participantId: participant.id,
    participants: Array.from(room.participants.values()).map((p) => ({
      id: p.id,
      displayName: p.displayName,
    })),
  });

  // Notify others in room
  broadcastToRoom(room, participant.id, {
    type: 'participant-joined',
    participantId: participant.id,
    displayName: participant.displayName,
  });

  logger.info({ roomId, participantId: participant.id }, 'Participant joined room');
}

function handleLeaveRoom(participant: Participant): void {
  if (!participant.roomId) return;

  const room = rooms.get(participant.roomId);
  if (room) {
    room.participants.delete(participant.id);

    // Notify others
    broadcastToRoom(room, participant.id, {
      type: 'participant-left',
      participantId: participant.id,
    });

    // Clean up empty rooms
    if (room.participants.size === 0) {
      rooms.delete(room.id);
      logger.info({ roomId: room.id }, 'Room deleted (empty)');
    }
  }

  logger.info({ roomId: participant.roomId, participantId: participant.id }, 'Participant left room');
  participant.roomId = null;
}

function handleOffer(participant: Participant, message: SignalingMessage): void {
  relayToTarget(participant, message, 'offer');
}

function handleAnswer(participant: Participant, message: SignalingMessage): void {
  relayToTarget(participant, message, 'answer');
}

function handleIceCandidate(participant: Participant, message: SignalingMessage): void {
  relayToTarget(participant, message, 'ice-candidate');
}

function handleKeyExchange(participant: Participant, message: SignalingMessage): void {
  // Relay encrypted key material without inspecting it
  // Server never has access to actual encryption keys
  relayToTarget(participant, message, 'key-exchange');
}

function handleKeyBroadcast(participant: Participant, message: SignalingMessage): void {
  // Broadcast encrypted key to all participants in room
  if (!participant.roomId) {
    sendError(participant, 'NOT_IN_ROOM', 'Must be in a room');
    return;
  }

  const room = rooms.get(participant.roomId);
  if (!room) return;

  broadcastToRoom(room, participant.id, {
    type: 'key-broadcast',
    senderId: participant.id,
    payload: message.payload,
  });
}

// Helpers
function relayToTarget(
  participant: Participant,
  message: SignalingMessage,
  type: string
): void {
  const { targetId, payload } = message;
  if (!targetId) {
    sendError(participant, 'INVALID_MESSAGE', 'targetId is required');
    return;
  }

  const target = participants.get(targetId);
  if (!target || target.roomId !== participant.roomId) {
    sendError(participant, 'TARGET_NOT_FOUND', 'Target participant not found');
    return;
  }

  send(target, {
    type,
    senderId: participant.id,
    payload,
  });
}

function broadcastToRoom(room: Room, excludeId: string, message: object): void {
  for (const [id, p] of room.participants) {
    if (id !== excludeId) {
      send(p, message);
    }
  }
}

function send(participant: Participant, message: object): void {
  if (participant.socket.readyState === WebSocket.OPEN) {
    participant.socket.send(JSON.stringify(message));
  }
}

function sendError(participant: Participant, code: string, message: string): void {
  send(participant, { type: 'error', code, message });
}

// WebSocket connection handler
wss.on('connection', (socket) => {
  const participant: Participant = {
    id: uuidv4(),
    socket,
    roomId: null,
    joinedAt: Date.now(),
  };

  participants.set(participant.id, participant);
  logger.info({ participantId: participant.id }, 'Client connected');

  // Send welcome message with participant ID
  send(participant, {
    type: 'welcome',
    participantId: participant.id,
  });

  // Message handler
  socket.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString()) as SignalingMessage;

      switch (message.type) {
        case 'join':
          handleJoinRoom(participant, message);
          break;
        case 'leave':
          handleLeaveRoom(participant);
          break;
        case 'offer':
          handleOffer(participant, message);
          break;
        case 'answer':
          handleAnswer(participant, message);
          break;
        case 'ice-candidate':
          handleIceCandidate(participant, message);
          break;
        case 'key-exchange':
          handleKeyExchange(participant, message);
          break;
        case 'key-broadcast':
          handleKeyBroadcast(participant, message);
          break;
        case 'ping':
          send(participant, { type: 'pong' });
          break;
        default:
          sendError(participant, 'UNKNOWN_MESSAGE', `Unknown message type: ${message.type}`);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to process message');
      sendError(participant, 'INVALID_MESSAGE', 'Failed to parse message');
    }
  });

  // Disconnect handler
  socket.on('close', () => {
    handleLeaveRoom(participant);
    participants.delete(participant.id);
    logger.info({ participantId: participant.id }, 'Client disconnected');
  });

  // Error handler
  socket.on('error', (error) => {
    logger.error({ error, participantId: participant.id }, 'WebSocket error');
  });
});

// Start server
httpServer.listen(PORT, () => {
  logger.info({ port: PORT }, 'Signaling server started');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  wss.close(() => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
});
