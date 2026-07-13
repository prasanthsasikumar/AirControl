/**
 * AirControl — Server with Socket.IO relay
 *
 * Serves static files from /public and relays hand-tracking data between
 * /read (phone) and /show (laptop) via Socket.IO rooms.
 *
 * Architecture:
 *   1. Viewer (/show) creates a room → gets a room code.
 *   2. Reader (/read) joins that room.
 *   3. Reader sends hand data → server relays to the room → viewer receives.
 *
 * Usage:  node server.js
 */

function attachRelay(io) {
  const rooms = new Map(); // roomCode → { viewer, readers:Set }

  io.on('connection', (socket) => {
    console.log(`[io] connected: ${socket.id}`);

    socket.on('create-room', (roomCode, ack) => {
      socket.join(roomCode);
      rooms.set(roomCode, { viewer: socket.id, readers: new Set() });
      socket.data.room = roomCode;
      socket.data.role = 'viewer';
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('join-room', (roomCode, ack) => {
      const room = rooms.get(roomCode);
      if (!room) { if (typeof ack === 'function') ack({ ok: false, error: 'Room not found' }); return; }
      socket.join(roomCode);
      room.readers.add(socket.id);
      socket.data.room = roomCode;
      socket.data.role = 'reader';
      io.to(room.viewer).emit('reader-connected', { id: socket.id });
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('hand', (data) => {
      const roomCode = socket.data.room;
      if (!roomCode) return;
      socket.volatile.to(roomCode).emit('hand', data);
    });

    // Glasses → room: presenter control intents
    socket.on('intent', (data) => {
      const roomCode = socket.data.room;
      if (!roomCode) return;
      socket.to(roomCode).emit('intent', data);
    });

    // Extension → room: teleprompter HUD state
    socket.on('hud', (data) => {
      const roomCode = socket.data.room;
      if (!roomCode) return;
      socket.to(roomCode).emit('hud', data);
    });

    socket.on('msg', (data) => {
      const roomCode = socket.data.room;
      if (!roomCode) return;
      socket.to(roomCode).emit('msg', data);
    });

    socket.on('disconnect', (reason) => {
      const roomCode = socket.data.room;
      const role = socket.data.role;
      if (roomCode && rooms.has(roomCode)) {
        const room = rooms.get(roomCode);
        if (role === 'viewer') { io.to(roomCode).emit('room-closed'); rooms.delete(roomCode); }
        else if (role === 'reader') { room.readers.delete(socket.id); io.to(roomCode).emit('reader-disconnected', { id: socket.id }); }
      }
    });
  });
}

module.exports = { attachRelay };

if (require.main === module) {
  const express = require('express');
  const http = require('http');
  const { Server } = require('socket.io');
  const path = require('path');

  const PORT = process.env.PORT || 3000;
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*' },
    // Tolerant heartbeat so a briefly-backgrounded tab isn't dropped instantly.
    pingInterval: 20000, pingTimeout: 20000, maxHttpBufferSize: 1e6,
  });

  // Registered before express.static: public/glasses/ is a real directory, and
  // static's directory handler would otherwise 301-redirect /glasses -> /glasses/
  // before this route ever ran.
  app.get('/glasses', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'glasses', 'index.html')));
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/read', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'read.html')));
  app.get('/show', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'show.html')));

  attachRelay(io);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  AirControl running on http://localhost:${PORT}`);
    console.log(`  Open /show on your laptop, /read on your phone.\n`);
  });
}
