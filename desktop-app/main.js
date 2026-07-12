/**
 * main.js — AirControl Desktop App (Electron main process)
 *
 * 1. Creates a window with QR code UI
 * 2. Connects to AirControl server via Socket.IO
 * 3. Receives hand gestures
 * 4. Emulates keyboard keys (LEFT/RIGHT arrows) system-wide
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const io = require('socket.io-client');
const robot = require('robotjs');

const DEFAULT_SERVER = 'https://aircontrol.flowsxr.com';

let mainWindow;
let socket = null;
let isActive = false;
let readerConnected = false;
let currentConfig = {
  serverUrl: DEFAULT_SERVER,
  roomCode: '',
  swapHands: false
};

// ─── Create window ────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 450,
    height: 700,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('renderer.html');
  
  // Open DevTools in development
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── Gesture Detection ────────────────────────────────────────────────────────
class SlideGestureDetector {
  constructor() {
    this.PINCH_THRESHOLD = 0.08;
    this.COOLDOWN = 500;
    this.RELEASE_DELAY = 200;
    this._wasPinching = false;
    this._tapStartTime = 0;
    this._lastTrigger = 0;
    this._lastReleaseTime = 0;
    this._pendingHandedness = null;
  }

  process(landmarks, handedness) {
    if (!landmarks || landmarks.length < 21) return null;

    const thumb = landmarks[4];
    const index = landmarks[8];
    const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
    const pinching = dist < this.PINCH_THRESHOLD;
    const now = Date.now();

    let action = null;

    if (pinching && !this._wasPinching) {
      if (now - this._lastReleaseTime >= this.RELEASE_DELAY) {
        this._tapStartTime = now;
        this._pendingHandedness = handedness || 'Right';
        console.log(`[detector] tap started (${this._pendingHandedness})`);
      }
    } else if (!pinching && this._wasPinching) {
      this._lastReleaseTime = now;
      
      if (this._tapStartTime > 0 && (now - this._lastTrigger >= this.COOLDOWN)) {
        const hand = this._pendingHandedness || 'Right';
        action = hand === 'Left' ? 'prev' : 'next';
        this._lastTrigger = now;
        console.log(`[detector] tap completed (${hand}) → ${action}`);
      } else if (now - this._lastTrigger < this.COOLDOWN) {
        console.log(`[detector] tap ignored - cooldown (${Math.round(this.COOLDOWN - (now - this._lastTrigger))}ms)`);
      }
      
      this._tapStartTime = 0;
      this._pendingHandedness = null;
    }

    this._wasPinching = pinching;
    return action;
  }

  reset() {
    this._wasPinching = false;
    this._tapStartTime = 0;
    this._pendingHandedness = null;
    this._lastReleaseTime = 0;
  }
}

const detector = new SlideGestureDetector();

// ─── Keyboard Emulation ───────────────────────────────────────────────────────
function pressKey(key) {
  try {
    robot.keyTap(key);
    console.log(`[keyboard] pressed ${key.toUpperCase()} arrow`);
  } catch (err) {
    console.error('[keyboard] error:', err);
  }
}

// ─── Socket.IO Connection ─────────────────────────────────────────────────────
function startListening(config) {
  stopListening();
  
  currentConfig = { ...currentConfig, ...config };
  const { serverUrl, roomCode, swapHands } = currentConfig;
  
  if (!roomCode) {
    console.warn('[main] no room code');
    return;
  }

  isActive = true;
  detector.reset();

  console.log('[main] connecting to', serverUrl, 'room:', roomCode);
  socket = io(serverUrl, {
    transports: ['websocket'],
    reconnection: true
  });

  socket.on('connect', () => {
    console.log('[main] connected — creating room', roomCode);
    socket.emit('create-room', roomCode, (resp) => {
      if (resp && resp.ok) {
        console.log('[main] created room', roomCode);
        broadcastStatus();
      } else {
        console.error('[main] create-room failed', resp);
        broadcastStatus();
      }
    });
  });

  socket.on('reader-connected', (data) => {
    console.log('[main] phone connected:', data.id);
    readerConnected = true;
    broadcastStatus();
  });

  socket.on('hand', (data) => {
    const handedness = data.handedness?.label || 'Right';
    let action = detector.process(data.landmarks, handedness);
    
    // Swap if enabled
    if (action && swapHands) {
      action = action === 'next' ? 'prev' : 'next';
    }
    
    if (action) {
      console.log('[main] gesture detected:', action);
      const key = action === 'next' ? 'right' : 'left';
      pressKey(key);
    }
  });

  socket.on('disconnect', () => {
    console.log('[main] disconnected');
    readerConnected = false;
    broadcastStatus();
  });

  socket.on('error', (err) => {
    console.error('[main] socket error:', err);
  });

  broadcastStatus();
}

function stopListening() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  isActive = false;
  readerConnected = false;
  detector.reset();
  broadcastStatus();
}

function broadcastStatus() {
  if (mainWindow) {
    mainWindow.webContents.send('status-update', {
      active: isActive,
      connected: socket?.connected ?? false,
      readerConnected: readerConnected
    });
  }
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('start', (_event, config) => {
  startListening(config);
  return { ok: true };
});

ipcMain.handle('stop', () => {
  stopListening();
  return { ok: true };
});

ipcMain.handle('get-status', () => {
  return {
    active: isActive,
    connected: socket?.connected ?? false,
    readerConnected: readerConnected,
    config: currentConfig
  };
});

ipcMain.handle('update-swap-hands', (_event, swapHands) => {
  currentConfig.swapHands = swapHands;
  console.log('[main] swap hands updated:', swapHands);
  return { ok: true };
});
