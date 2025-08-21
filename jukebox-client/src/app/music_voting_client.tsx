import React, { useState, useEffect, useRef } from 'react';
import { Music, Users, ThumbsUp, ThumbsDown, Plus, UserPlus, LogOut, Volume2 } from 'lucide-react';

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
  score?: number;
  votes?: Vote[];
}

interface Vote {
  participantId: string;
  songId: string;
  vote: 'up' | 'down';
  timestamp: number;
  participant?: Participant;
}

interface Room {
  id: string;
  name: string;
  participants: Participant[];
  queue: Song[];
  currentSong?: Song;
  isActive: boolean;
}

// Simple state management (Redux-like but lightweight)
interface AppState {
  room: Room | null;
  participantId: string | null;
  isConnected: boolean;
  error: string | null;
}

const initialState: AppState = {
  room: null,
  participantId: null,
  isConnected: false,
  error: null,
};

// Mock Pusher for demo (replace with actual Pusher)
class MockPusher {
  private channels: Map<string, any> = new Map();
  
  subscribe(channelName: string) {
    if (!this.channels.has(channelName)) {
      this.channels.set(channelName, { callbacks: new Map() });
    }
    
    return {
      bind: (event: string, callback: Function) => {
        const channel = this.channels.get(channelName);
        if (!channel.callbacks.has(event)) {
          channel.callbacks.set(event, []);
        }
        channel.callbacks.get(event).push(callback);
      },
      unbind: (event: string) => {
        const channel = this.channels.get(channelName);
        if (channel) {
          channel.callbacks.delete(event);
        }
      }
    };
  }
  
  // Simulate real-time events for demo
  simulateEvent(channelName: string, event: string, data: any) {
    const channel = this.channels.get(channelName);
    if (channel && channel.callbacks.has(event)) {
      channel.callbacks.get(event).forEach((callback: Function) => callback(data));
    }
  }
}

const pusher = new MockPusher();
const API_BASE = 'http://localhost:3001/api';

export default function MusicVotingApp() {
  const [state, setState] = useState<AppState>(initialState);
  const [view, setView] = useState<'welcome' | 'room'>('welcome');
  const [showAddSong, setShowAddSong] = useState(false);
  const channelRef = useRef<any>(null);

  // API calls
  const createRoom = async (roomName: string, userName: string) => {
    try {
      const response = await fetch(`${API_BASE}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: roomName, creatorName: userName }),
      });
      
      if (!response.ok) throw new Error('Failed to create room');
      
      const data = await response.json();
      setState(prev => ({
        ...prev,
        room: data.room,
        participantId: data.participantId,
        isConnected: true,
        error: null,
      }));
      
      subscribeToRoom(data.roomId);
      setView('room');
    } catch (error) {
      setState(prev => ({ ...prev, error: 'Failed to create room' }));
    }
  };

  const joinRoom = async (roomId: string, userName: string) => {
    try {
      const response = await fetch(`${API_BASE}/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: userName }),
      });
      
      if (!response.ok) throw new Error('Failed to join room');
      
      const data = await response.json();
      setState(prev => ({
        ...prev,
        room: data.room,
        participantId: data.participantId,
        isConnected: true,
        error: null,
      }));
      
      subscribeToRoom(roomId);
      setView('room');
    } catch (error) {
      setState(prev => ({ ...prev, error: 'Failed to join room' }));
    }
  };

  const addSong = async (song: Partial<Song>) => {
    if (!state.room || !state.participantId) return;
    
    try {
      const response = await fetch(`${API_BASE}/rooms/${state.room.id}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: state.participantId, song }),
      });
      
      if (!response.ok) throw new Error('Failed to add song');
      setShowAddSong(false);
    } catch (error) {
      setState(prev => ({ ...prev, error: 'Failed to add song' }));
    }
  };

  const vote = async (songId: string, voteType: 'up' | 'down') => {
    if (!state.room || !state.participantId) return;
    
    try {
      const response = await fetch(`${API_BASE}/rooms/${state.room.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantId: state.participantId,
          songId,
          vote: voteType,
        }),
      });
      
      if (!response.ok) throw new Error('Failed to vote');
    } catch (error) {
      setState(prev => ({ ...prev, error: 'Failed to vote' }));
    }
  };

  const leaveRoom = async () => {
    if (!state.room || !state.participantId) return;
    
    try {
      await fetch(`${API_BASE}/rooms/${state.room.id}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: state.participantId }),
      });
      
      if (channelRef.current) {
        channelRef.current.unbind('participant-joined');
        channelRef.current.unbind('participant-left');
        channelRef.current.unbind('queue-updated');
        channelRef.current.unbind('vote-updated');
      }
      
      setState(initialState);
      setView('welcome');
    } catch (error) {
      setState(prev => ({ ...prev, error: 'Failed to leave room' }));
    }
  };

  const subscribeToRoom = (roomId: string) => {
    const channel = pusher.subscribe(`room-${roomId}`);
    channelRef.current = channel;

    channel.bind('participant-joined', (data: any) => {
      setState(prev => prev.room ? {
        ...prev,
        room: {
          ...prev.room,
          participants: [...prev.room.participants, data.participant]
        }
      } : prev);
    });

    channel.bind('participant-left', (data: any) => {
      setState(prev => prev.room ? {
        ...prev,
        room: {
          ...prev.room,
          participants: prev.room.participants.filter(p => p.id !== data.participantId),
          isActive: data.isActive
        }
      } : prev);
    });

    channel.bind('queue-updated', (data: any) => {
      setState(prev => prev.room ? {
        ...prev,
        room: {
          ...prev.room,
          queue: data.queue
        }
      } : prev);
    });

    channel.bind('vote-updated', (data: any) => {
      setState(prev => prev.room ? {
        ...prev,
        room: {
          ...prev.room,
          queue: data.queue
        }
      } : prev);
    });
  };

  const getUserVote = (song: Song): 'up' | 'down' | null => {
    if (!song.votes || !state.participantId) return null;
    const userVote = song.votes.find(v => v.participantId === state.participantId);
    return userVote ? userVote.vote : null;
  };

  if (view === 'welcome') {
    return <WelcomeScreen onCreateRoom={createRoom} onJoinRoom={joinRoom} error={state.error} />;
  }

  if (!state.room) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      {/* Header */}
      <header className="bg-black/30 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Music className="w-8 h-8 text-purple-400" />
            <div>
              <h1 className="text-xl font-bold text-white">{state.room.name}</h1>
              <p className="text-sm text-gray-300">Room: {state.room.id}</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-sm text-gray-300">
              <Users className="w-4 h-4" />
              <span>{state.room.participants.length}</span>
            </div>
            <button
              onClick={leaveRoom}
              className="flex items-center space-x-2 px-3 py-2 bg-red-600/20 hover:bg-red-600/30 rounded-lg text-red-400 text-sm transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Leave</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Queue Section */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Song Queue</h2>
              <button
                onClick={() => setShowAddSong(true)}
                className="flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-white font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Add Song</span>
              </button>
            </div>

            <div className="space-y-3">
              {state.room.queue.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Music className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg mb-2">No songs in queue</p>
                  <p className="text-sm">Be the first to add a song!</p>
                </div>
              ) : (
                state.room.queue.map((song, index) => (
                  <SongCard
                    key={song.id}
                    song={song}
                    index={index}
                    userVote={getUserVote(song)}
                    onVote={vote}
                    participants={state.room!.participants}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Participants Sidebar */}
        <div className="space-y-6">
          <ParticipantsList participants={state.room.participants} />
        </div>
      </div>

      {/* Add Song Modal */}
      {showAddSong && (
        <AddSongModal
          onClose={() => setShowAddSong(false)}
          onAddSong={addSong}
        />
      )}

      {/* Error Toast */}
      {state.error && (
        <div className="fixed bottom-4 right-4 bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg">
          {state.error}
          <button
            onClick={() => setState(prev => ({ ...prev, error: null }))}
            className="ml-3 text-red-200 hover:text-white"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function WelcomeScreen({ onCreateRoom, onJoinRoom, error }: {
  onCreateRoom: (roomName: string, userName: string) => void;
  onJoinRoom: (roomId: string, userName: string) => void;
  error: string | null;
}) {
  const [mode, setMode] = useState<'create' | 'join' | null>(null);
  const [roomName, setRoomName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [userName, setUserName] = useState('');

  const handleSubmit = () => {
    if (mode === 'create') {
      onCreateRoom(roomName, userName);
    } else if (mode === 'join') {
      onJoinRoom(roomId.toUpperCase(), userName);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 border border-white/20 w-full max-w-md">
        <div className="text-center mb-8">
          <Music className="w-16 h-16 text-purple-400 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-white mb-2">Music Voting</h1>
          <p className="text-gray-300">Vote on songs together with friends</p>
        </div>

        {!mode ? (
          <div className="space-y-4">
            <button
              onClick={() => setMode('create')}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 rounded-lg text-white font-medium transition-colors"
            >
              Create New Room
            </button>
            <button
              onClick={() => setMode('join')}
              className="w-full py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white font-medium transition-colors"
            >
              Join Existing Room
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {mode === 'create' ? (
              <input
                type="text"
                placeholder="Room name"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                required
              />
            ) : (
              <input
                type="text"
                placeholder="Room code (e.g. ABC123)"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                maxLength={6}
                required
              />
            )}
            <input
              type="text"
              placeholder="Your name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              required
            />
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setMode(null)}
                className="flex-1 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white font-medium transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                onClick={handleSubmit}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg text-white font-medium transition-colors"
              >
                {mode === 'create' ? 'Create' : 'Join'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-red-600/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function SongCard({ song, index, userVote, onVote, participants }: {
  song: Song;
  index: number;
  userVote: 'up' | 'down' | null;
  onVote: (songId: string, vote: 'up' | 'down') => void;
  participants: Participant[];
}) {
  const addedBy = participants.find(p => p.id === song.addedBy);
  const upVotes = song.votes?.filter(v => v.vote === 'up') || [];
  const downVotes = song.votes?.filter(v => v.vote === 'down') || [];

  return (
    <div className="bg-white/5 hover:bg-white/10 rounded-xl p-4 border border-white/10 transition-colors">
      <div className="flex items-center space-x-4">
        <div className="text-2xl font-bold text-purple-400 w-8">
          #{index + 1}
        </div>
        
        <div className="flex-1">
          <h3 className="font-semibold text-white text-lg">{song.title}</h3>
          <p className="text-gray-300">{song.artist}</p>
          {addedBy && (
            <p className="text-xs text-gray-400 mt-1">Added by {addedBy.name}</p>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <div className="text-center">
            <button
              onClick={() => onVote(song.id, 'up')}
              className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
                userVote === 'up'
                  ? 'bg-green-600 text-white'
                  : 'bg-white/10 hover:bg-green-600/20 text-gray-300 hover:text-green-400'
              }`}
            >
              <ThumbsUp className="w-4 h-4" />
            </button>
            <span className="text-xs text-green-400 font-medium">{upVotes.length}</span>
          </div>
          
          <div className="text-center">
            <button
              onClick={() => onVote(song.id, 'down')}
              className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
                userVote === 'down'
                  ? 'bg-red-600 text-white'
                  : 'bg-white/10 hover:bg-red-600/20 text-gray-300 hover:text-red-400'
              }`}
            >
              <ThumbsDown className="w-4 h-4" />
            </button>
            <span className="text-xs text-red-400 font-medium">{downVotes.length}</span>
          </div>

          <div className="text-lg font-bold text-white ml-2">
            {song.score || 0}
          </div>
        </div>
      </div>

      {/* Vote details */}
      {(upVotes.length > 0 || downVotes.length > 0) && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="flex flex-wrap gap-2 text-xs">
            {upVotes.map(vote => (
              <span key={vote.participantId} className="px-2 py-1 bg-green-600/20 text-green-400 rounded-full">
                👍 {vote.participant?.name}
              </span>
            ))}
            {downVotes.map(vote => (
              <span key={vote.participantId} className="px-2 py-1 bg-red-600/20 text-red-400 rounded-full">
                👎 {vote.participant?.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ParticipantsList({ participants }: { participants: Participant[] }) {
  return (
    <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center space-x-2">
        <Users className="w-5 h-5" />
        <span>Participants ({participants.length})</span>
      </h3>
      
      <div className="space-y-3">
        {participants.map(participant => (
          <div key={participant.id} className="flex items-center space-x-3 p-3 bg-white/5 rounded-lg">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full flex items-center justify-center text-white font-semibold">
              {participant.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="font-medium text-white">{participant.name}</p>
              <p className="text-xs text-gray-400">
                Joined {new Date(participant.joinedAt).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddSongModal({ onClose, onAddSong }: {
  onClose: () => void;
  onAddSong: (song: Partial<Song>) => void;
}) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');

  const handleSubmit = () => {
    onAddSong({
      title,
      artist,
      duration: 180, // Default 3 minutes
    });
    setTitle('');
    setArtist('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20 w-full max-w-md">
        <h3 className="text-xl font-bold text-white mb-4">Add Song</h3>
        
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Song title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            required
          />
          <input
            type="text"
            placeholder="Artist"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            required
          />
          
          <div className="flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg text-white font-medium transition-colors"
            >
              Add Song
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}