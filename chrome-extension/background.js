/**
 * background.js — SpatialGrip Chrome Extension service worker
 *
 * 1. Connects to the SpatialGrip server via native WebSocket
 *    (speaks the Socket.IO EIO4 wire protocol — no external libraries).
 * 2. Creates a room and receives hand-tracking data from phones that join.
 * 3. Runs slide-gesture detection (single tap with cooldown).
 * 4. Forwards "next" / "prev" commands to the active-tab content script.
 */

// ─── Minimal Socket.IO-over-WebSocket client ──────────────────────────────────
// Implements just enough of Engine.IO v4 + Socket.IO v4 to join a room and
// receive events — zero dependencies.

class MiniSocketIO {
  constructor(serverUrl) {
    this._url = serverUrl.replace(/\/+$/, '');
    this.ws = null;
    this.sid = null;
    this.connected = false;
    this._ackId = 0;
    this._acks = {};
    this._handlers = {};
  }

  connect() {
    const wsUrl =
      this._url.replace(/^http/, 'ws') +
      '/socket.io/?EIO=4&transport=websocket';
    console.log('[bg] connecting WS:', wsUrl);

    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => console.log('[bg] WS open');
    this.ws.onmessage = (e) => this._onRaw(e.data);
    this.ws.onclose = () => {
      console.log('[bg] WS closed');
      this.connected = false;
      this._fire('disconnect');
    };
    this.ws.onerror = (e) => {
      console.error('[bg] WS error', e);
      this._fire('error', e);
    };
  }

  // ── Send a Socket.IO event ──────────────────────────────────────────────
  emit(event, ...args) {
    const last = args[args.length - 1];
    const hasAck = typeof last === 'function';
    const ack = hasAck ? args.pop() : null;

    let packet;
    if (ack) {
      const id = this._ackId++;
      this._acks[id] = ack;
      packet = `42${id}${JSON.stringify([event, ...args])}`;
    } else {
      packet = `42${JSON.stringify([event, ...args])}`;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(packet);
    }
  }

  on(event, handler) {
    (this._handlers[event] ||= []).push(handler);
  }

  disconnect() {
    if (this.ws) this.ws.close();
  }

  // ── Internal: parse incoming frames ─────────────────────────────────────
  _onRaw(raw) {
    const eioType = parseInt(raw[0], 10);
    const rest = raw.slice(1);

    switch (eioType) {
      case 0: { // Engine.IO OPEN
        const info = JSON.parse(rest);
        this.sid = info.sid;
        console.log('[bg] EIO open, sid:', this.sid);
        // Send Socket.IO CONNECT to default namespace
        this.ws.send('40');
        break;
      }
      case 2: // Engine.IO PING
        this.ws.send('3'); // PONG
        break;
      case 4: // Engine.IO MESSAGE → Socket.IO packet
        this._parseSIO(rest);
        break;
    }
  }

  _parseSIO(raw) {
    const sioType = parseInt(raw[0], 10);
    const rest = raw.slice(1);

    switch (sioType) {
      case 0: // SIO CONNECT
        this.connected = true;
        console.log('[bg] SIO connected');
        this._fire('connect');
        break;
      case 2: { // SIO EVENT
        // Could have an ack id prefix before the JSON array
        const m = rest.match(/^(\d*?)(\[.*)$/s);
        if (!m) break;
        const data = JSON.parse(m[2]);
        const [event, ...args] = data;
        this._fire(event, ...args);
        break;
      }
      case 3: { // SIO ACK
        const m = rest.match(/^(\d+)(.*)$/s);
        if (m) {
          const id = parseInt(m[1], 10);
          const payload = JSON.parse(m[2]);
          if (this._acks[id]) {
            this._acks[id](...(Array.isArray(payload) ? payload : [payload]));
            delete this._acks[id];
          }
        }
        break;
      }
    }
  }

  _fire(event, ...args) {
    (this._handlers[event] || []).forEach((h) => h(...args));
  }
}

// ─── Slide Gesture Detector ───────────────────────────────────────────────────
// Detects single tap gestures (pinch → release) and emits "next" / "prev" actions.
//
// Interaction:
//   • Right hand: tap (pinch then release) → next slide
//   • Left hand:  tap (pinch then release) → previous slide
//   • Minimum 500ms between taps to prevent accidental multi-triggers

class SlideGestureDetector {
  constructor() {
    this.PINCH_THRESHOLD = 0.08;      // distance threshold for pinch detection
    this.COOLDOWN = 500;              // ms minimum between tap triggers
    this.RELEASE_DELAY = 200;         // ms - must hold fingers apart to complete release

    this._wasPinching = false;
    this._tapStartTime = 0;
    this._lastTrigger = 0;
    this._lastReleaseTime = 0;
    this._pendingHandedness = null;
  }

  /**
   * Feed a frame of 21 landmarks + handedness.
   * @param {Array} landmarks - 21 hand points
   * @param {string} handedness - 'Left' or 'Right'
   * @returns {'next'|'prev'|null}
   */
  process(landmarks, handedness) {
    if (!landmarks || landmarks.length < 21) return null;

    const thumb = landmarks[4];
    const index = landmarks[8];

    const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
    const pinching = dist < this.PINCH_THRESHOLD;
    const now = Date.now();

    let action = null;

    if (pinching && !this._wasPinching) {
      // ── Pinch just started ──────────────────────────────────────────────
      // Only register if enough time has passed since last release
      if (now - this._lastReleaseTime >= this.RELEASE_DELAY) {
        this._tapStartTime = now;
        this._pendingHandedness = handedness || 'Right';
        console.log(`[detector] tap started (${this._pendingHandedness})`);
      }
    } else if (!pinching && this._wasPinching) {
      // ── Pinch just released → trigger action ────────────────────────────
      this._lastReleaseTime = now;
      
      // Only trigger if:
      // 1. We had a valid tap start
      // 2. Cooldown period has passed since last trigger
      if (this._tapStartTime > 0 && (now - this._lastTrigger >= this.COOLDOWN)) {
        const hand = this._pendingHandedness || 'Right';
        action = hand === 'Left' ? 'prev' : 'next';
        this._lastTrigger = now;
        console.log(`[detector] tap completed (${hand}) → ${action}`);
      } else if (now - this._lastTrigger < this.COOLDOWN) {
        console.log(`[detector] tap ignored - cooldown active (${Math.round(this.COOLDOWN - (now - this._lastTrigger))}ms remaining)`);
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

// ─── State ────────────────────────────────────────────────────────────────────
let socket = null;
let detector = new SlideGestureDetector();
let isActive = false;
let readerConnected = false;
let currentConfig = { serverUrl: 'https://spatialgrip.flowsxr.com', roomCode: '', swapHands: false };

// ─── Message handling from popup / content script ─────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case 'get-status':
      sendResponse({
        active: isActive,
        connected: socket?.connected ?? false,
        readerConnected: readerConnected,
        config: currentConfig,
      });
      return true;

    case 'start':
      currentConfig = { ...currentConfig, ...msg.config };
      chrome.storage.local.set({ config: currentConfig });
      startListening();
      sendResponse({ ok: true });
      return true;

    case 'stop':
      stopListening();
      sendResponse({ ok: true });
      return true;

    case 'update-swap-hands':
      currentConfig.swapHands = msg.swapHands;
      chrome.storage.local.set({ config: currentConfig });
      console.log('[bg] swap hands updated:', msg.swapHands);
      sendResponse({ ok: true });
      return true;
  }
});

// Restore saved config on startup
chrome.storage.local.get('config', (res) => {
  if (res.config) currentConfig = res.config;
});

// ─── Core: connect to server and process hand data ────────────────────────────
function startListening() {
  stopListening(); // clean up any previous connection

  const { serverUrl, roomCode } = currentConfig;
  if (!roomCode) {
    console.warn('[bg] no room code configured');
    return;
  }

  isActive = true;
  readerConnected = false;
  detector.reset();

  socket = new MiniSocketIO(serverUrl);

  socket.on('connect', () => {
    console.log('[bg] Socket.IO connected — creating room', roomCode);
    socket.emit('create-room', roomCode, (resp) => {
      if (resp && resp.ok) {
        console.log('[bg] created room', roomCode, '— waiting for phone...');
        broadcastStatus();
      } else {
        console.error('[bg] create-room failed', resp);
        broadcastStatus();
      }
    });
  });

  socket.on('reader-connected', (data) => {
    console.log('[bg] phone connected:', data.id);
    readerConnected = true;
    broadcastStatus();
  });

  socket.on('hand', (data) => {
    const handedness = data.handedness?.label || 'Right';
    let action = detector.process(data.landmarks, handedness);

    // Swap action if swapHands is enabled
    if (action && currentConfig.swapHands) {
      action = action === 'next' ? 'prev' : 'next';
    }

    if (action) {
      console.log('[bg] gesture detected:', action);
      sendToActiveTab({ type: 'slide-action', action });
    }

    // Forward pinch state for visual feedback
    const thumb = data.landmarks[4];
    const index = data.landmarks[8];
    const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
    sendToActiveTab({
      type: 'gesture-state',
      pinching: dist < detector.PINCH_THRESHOLD,
      handedness,
      action,
    });
  });

  socket.on('intent', (data) => {
    let action = data && data.action === 'prev' ? 'prev' : 'next';
    if (currentConfig.swapHands) action = action === 'next' ? 'prev' : 'next';
    console.log('[bg] intent received:', action);
    sendToActiveTab({ type: 'slide-action', action });
  });

  socket.on('disconnect', () => {
    console.log('[bg] disconnected');
    readerConnected = false;
    broadcastStatus();
  });

  socket.connect();
  broadcastStatus();
}

function stopListening() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  isActive = false;
  detector.reset();
  broadcastStatus();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function sendToActiveTab(msg) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    }
  } catch (_) {}
}

function broadcastStatus() {
  chrome.runtime.sendMessage({
    type: 'status-update',
    active: isActive,
    connected: socket?.connected ?? false,
    readerConnected: readerConnected,
  }).catch(() => {}); // popup might not be open
}
