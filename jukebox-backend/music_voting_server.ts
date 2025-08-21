// package.json dependencies needed:
// FEVERUP.COM


// npm install -D @types/express @types/node @types/uuid typescript ts-node nodemon

import express from 'express';
import Pusher from 'pusher';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Types
interface Participant {
  id: string;
  name: string;
  avatar?: string;
  joinedAt: number;
}

interface Song {
  id: string;
  title: string;
  artist: string;
  albumArt?: string;
  duration: number;
  spotifyId?: string;
  addedBy: string;
  addedAt: number;
}

interface Vote {
  participantId: string;
  songId: string;
  vote: 'up' | 'down';
  timestamp: number;
}

interface Room {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
  participants: Map<string, Participant>;
  queue: Song[];
  currentSong?: Song;
  votes: Map<string, Vote[]>; // songId -> votes
  isActive: boolean;
}

// Server setup
const app = express();
const PORT = process.env.PORT || 3001;

// Pusher configuration
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || 'your-app-id',
  key: process.env.PUSHER_KEY || 'your-key',
  secret: process.env.PUSHER_SECRET || 'your-secret',
  cluster: process.env.PUSHER_CLUSTER || 'us2',
  useTLS: true
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// In-memory storage (use Redis in production)
const rooms = new Map<string, Room>();
const participantRooms = new Map<string, string>(); // participantId -> roomId

// Utility functions
const generateRoomCode = (): string => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

const calculateSongScore = (votes: Vote[]): number => {
  return votes.reduce((score, vote) => {
    return score + (vote.vote === 'up' ? 1 : -1);
  }, 0);
};

const sortQueueByVotes = (queue: Song[], votesMap: Map<string, Vote[]>): Song[] => {
  return [...queue].sort((a, b) => {
    const scoreA = calculateSongScore(votesMap.get(a.id) || []);
    const scoreB = calculateSongScore(votesMap.get(b.id) || []);
    return scoreB - scoreA; // Higher score first
  });
};

// Routes

// Create a new room
app.post('/api/rooms', (req, res) => {
  try {
    const { name, creatorName, creatorAvatar } = req.body;
    
    if (!name || !creatorName) {
      return res.status(400).json({ error: 'Room name and creator name are required' });
    }

    const roomId = generateRoomCode();
    const participantId = uuidv4();
    
    const creator: Participant = {
      id: participantId,
      name: creatorName,
      avatar: creatorAvatar,
      joinedAt: Date.now()
    };

    const room: Room = {
      id: roomId,
      name,
      createdBy: participantId,
      createdAt: Date.now(),
      participants: new Map([[participantId, creator]]),
      queue: [],
      votes: new Map(),
      isActive: true
    };

    rooms.set(roomId, room);
    participantRooms.set(participantId, roomId);

    res.json({
      roomId,
      participantId,
      room: {
        id: room.id,
        name: room.name,
        participants: Array.from(room.participants.values()),
        queue: room.queue,
        currentSong: room.currentSong,
        isActive: room.isActive
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Join an existing room
app.post('/api/rooms/:roomId/join', (req, res) => {
  try {
    const { roomId } = req.params;
    const { name, avatar } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.isActive) {
      return res.status(400).json({ error: 'Room is no longer active' });
    }

    const participantId = uuidv4();
    const participant: Participant = {
      id: participantId,
      name,
      avatar,
      joinedAt: Date.now()
    };

    room.participants.set(participantId, participant);
    participantRooms.set(participantId, roomId);

    // Broadcast participant joined
    pusher.trigger(`room-${roomId}`, 'participant-joined', {
      participant,
      totalParticipants: room.participants.size
    });

    res.json({
      participantId,
      room: {
        id: room.id,
        name: room.name,
        participants: Array.from(room.participants.values()),
        queue: sortQueueByVotes(room.queue, room.votes),
        currentSong: room.currentSong,
        isActive: room.isActive
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// Add song to queue
app.post('/api/rooms/:roomId/queue', (req, res) => {
  try {
    const { roomId } = req.params;
    const { participantId, song } = req.body;

    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.participants.has(participantId)) {
      return res.status(403).json({ error: 'Not a participant in this room' });
    }

    const newSong: Song = {
      id: uuidv4(),
      title: song.title,
      artist: song.artist,
      albumArt: song.albumArt,
      duration: song.duration,
      spotifyId: song.spotifyId,
      addedBy: participantId,
      addedAt: Date.now()
    };

    room.queue.push(newSong);
    room.votes.set(newSong.id, []);

    const sortedQueue = sortQueueByVotes(room.queue, room.votes);

    // Broadcast queue update
    pusher.trigger(`room-${roomId}`, 'queue-updated', {
      queue: sortedQueue,
      addedSong: newSong,
      addedBy: room.participants.get(participantId)
    });

    res.json({ success: true, song: newSong });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add song to queue' });
  }
});

// Vote on a song
app.post('/api/rooms/:roomId/vote', (req, res) => {
  try {
    const { roomId } = req.params;
    const { participantId, songId, vote } = req.body;

    if (!['up', 'down'].includes(vote)) {
      return res.status(400).json({ error: 'Vote must be "up" or "down"' });
    }

    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.participants.has(participantId)) {
      return res.status(403).json({ error: 'Not a participant in this room' });
    }

    const songVotes = room.votes.get(songId) || [];
    
    // Remove existing vote from this participant
    const existingVoteIndex = songVotes.findIndex(v => v.participantId === participantId);
    if (existingVoteIndex >= 0) {
      songVotes.splice(existingVoteIndex, 1);
    }

    // Add new vote
    const newVote: Vote = {
      participantId,
      songId,
      vote,
      timestamp: Date.now()
    };
    songVotes.push(newVote);
    room.votes.set(songId, songVotes);

    const sortedQueue = sortQueueByVotes(room.queue, room.votes);

    // Broadcast vote update
    pusher.trigger(`room-${roomId}`, 'vote-updated', {
      songId,
      vote: newVote,
      participant: room.participants.get(participantId),
      songVotes,
      queue: sortedQueue
    });

    res.json({ success: true, queue: sortedQueue });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit vote' });
  }
});

// Get room state
app.get('/api/rooms/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;
    const { participantId } = req.query;

    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (participantId && !room.participants.has(participantId as string)) {
      return res.status(403).json({ error: 'Not a participant in this room' });
    }

    const sortedQueue = sortQueueByVotes(room.queue, room.votes);

    // Include vote details for each song
    const queueWithVotes = sortedQueue.map(song => {
      const votes = room.votes.get(song.id) || [];
      const score = calculateSongScore(votes);
      const votesWithParticipants = votes.map(vote => ({
        ...vote,
        participant: room.participants.get(vote.participantId)
      }));

      return {
        ...song,
        score,
        votes: votesWithParticipants
      };
    });

    res.json({
      id: room.id,
      name: room.name,
      participants: Array.from(room.participants.values()),
      queue: queueWithVotes,
      currentSong: room.currentSong,
      isActive: room.isActive
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get room state' });
  }
});

// Leave room
app.post('/api/rooms/:roomId/leave', (req, res) => {
  try {
    const { roomId } = req.params;
    const { participantId } = req.body;

    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const participant = room.participants.get(participantId);
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    // Remove participant
    room.participants.delete(participantId);
    participantRooms.delete(participantId);

    // Remove their votes
    room.votes.forEach((votes, songId) => {
      const filteredVotes = votes.filter(vote => vote.participantId !== participantId);
      room.votes.set(songId, filteredVotes);
    });

    // If room is empty or creator left, deactivate room
    if (room.participants.size === 0 || participantId === room.createdBy) {
      room.isActive = false;
    }

    // Broadcast participant left
    pusher.trigger(`room-${roomId}`, 'participant-left', {
      participantId,
      participant,
      totalParticipants: room.participants.size,
      isActive: room.isActive
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to leave room' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🎵 Music voting server running on port ${PORT}`);
});

// Cleanup inactive rooms periodically
setInterval(() => {
  const now = Date.now();
  const ROOM_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours

  rooms.forEach((room, roomId) => {
    if (!room.isActive || (now - room.createdAt > ROOM_TIMEOUT)) {
      // Clean up participant mappings
      room.participants.forEach((_, participantId) => {
        participantRooms.delete(participantId);
      });
      rooms.delete(roomId);
      console.log(`🧹 Cleaned up room ${roomId}`);
    }
  });
}, 60 * 60 * 1000); // Run every hour