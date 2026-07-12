# Ray-Ban Display Presenter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a presenter wearing Meta Ray-Ban Display glasses advance/reverse Google Slides hands-free via the Neural Band and read a private teleprompter (slide number, timer, speaker notes) in the HUD.

**Architecture:** A new glasses Web App (served from the existing Express server) reads Neural Band input — delivered by Meta's runtime as arrow-key / Enter events — and emits `intent` messages over the existing Socket.IO relay. The Chrome extension consumes `intent` to drive slides, and pushes `hud` messages (current slide index/total/notes scraped from Google Slides Presenter View) back through the relay to the glasses HUD. The relay stays a dumb room-scoped forwarder.

**Tech Stack:** Node.js + Express + Socket.IO (existing server); plain browser JS (no framework/build); Node built-in test runner (`node --test`); the extension's existing zero-dependency `MiniSocketIO` wire client, ported for the glasses app.

## Global Constraints

- **No new runtime dependencies.** Runtime deps stay `express` + `socket.io`. `socket.io-client` may be added as a **devDependency** only (for the relay integration test).
- **Node ≥ 18** required for the built-in test runner (`node --test`, `node:test`, `node:assert`).
- **Glasses HUD viewport is 600×600px**, dark background, high contrast (Meta Ray-Ban Display web-app constraint).
- **Neural Band input reaches the web app as keyboard events**: swipes → `ArrowLeft/ArrowRight/ArrowUp/ArrowDown`, index pinch/tap → `Enter`. All glasses input handling must be driveable by these keys (this is also how Meta's browser simulator tests it).
- **Relay message contracts (exact):**
  - `intent` (glasses → room): `{ action: 'next' | 'prev' }`
  - `hud` (extension → room): `{ index: number, total: number, notes: string, startedAt: number }` — `index` is 0-based; `startedAt` is an epoch-ms timestamp for the presentation timer.
- **Gesture mapping (v1):** `Enter` or `ArrowRight` → next; `ArrowLeft` → prev; `ArrowUp`/`ArrowDown` → scroll notes. `ArrowRight` doubling as next is intentional; there is no separate right-swipe action.
- **Glasses app must be reachable over public HTTPS** (Meta installs web apps by URL). It is served from the existing server under `/glasses`.
- **Pure-logic modules use the UMD footer** shown in Task 2 so the same file works as a browser global and a Node `require` target for tests.

---

### Task 1: Relay — add `intent` and `hud` message types

**Files:**
- Modify: `server.js` (add two handlers next to the existing `msg` handler, ~lines 82-87)
- Modify: `package.json` (add `test` script + `socket.io-client` devDependency)
- Create: `test/relay.test.js`

**Interfaces:**
- Consumes: existing Socket.IO events `create-room`, `join-room`.
- Produces: server relays `intent` and `hud` events to all other sockets in the sender's room (same semantics as the existing `msg` relay: `socket.to(roomCode).emit(event, data)`).

- [ ] **Step 1: Add the test script and devDependency to `package.json`**

Change the `scripts` and add `devDependencies`:

```json
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js",
    "test": "node --test"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.8.3"
  },
  "devDependencies": {
    "socket.io-client": "^4.8.3"
  },
```

Then run: `npm install`
Expected: `socket.io-client` added under `node_modules`, no errors.

- [ ] **Step 2: Write the failing integration test**

Create `test/relay.test.js`:

```js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');

// Import the relay wiring. server.js starts listening on import, so we
// require it and connect to its port via an ephemeral server instance here.
// To keep the test self-contained we re-create the same relay wiring by
// requiring a factory. server.js must export `attachRelay(io)` (added in Step 4).
const { attachRelay } = require('../server');

let httpServer, ioServer, port;

before(async () => {
  httpServer = http.createServer();
  ioServer = new Server(httpServer, { cors: { origin: '*' } });
  attachRelay(ioServer);
  await new Promise((res) => httpServer.listen(0, res));
  port = httpServer.address().port;
});

after(() => {
  ioServer.close();
  httpServer.close();
});

function connect() {
  return Client(`http://localhost:${port}`, { transports: ['websocket'] });
}

test('relays intent from reader to viewer in the same room', async () => {
  const viewer = connect();
  const reader = connect();
  await new Promise((res) => viewer.on('connect', res));
  await new Promise((res) => reader.on('connect', res));

  await new Promise((res) => viewer.emit('create-room', 'ROOM01', res));
  await new Promise((res) => reader.emit('join-room', 'ROOM01', res));

  const got = new Promise((res) => viewer.on('intent', res));
  reader.emit('intent', { action: 'next' });
  const payload = await got;
  assert.deepStrictEqual(payload, { action: 'next' });

  viewer.close();
  reader.close();
});

test('relays hud from viewer to reader in the same room', async () => {
  const viewer = connect();
  const reader = connect();
  await new Promise((res) => viewer.on('connect', res));
  await new Promise((res) => reader.on('connect', res));

  await new Promise((res) => viewer.emit('create-room', 'ROOM02', res));
  await new Promise((res) => reader.emit('join-room', 'ROOM02', res));

  const got = new Promise((res) => reader.on('hud', res));
  viewer.emit('hud', { index: 2, total: 10, notes: 'hello', startedAt: 111 });
  const payload = await got;
  assert.deepStrictEqual(payload, { index: 2, total: 10, notes: 'hello', startedAt: 111 });

  viewer.close();
  reader.close();
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `attachRelay is not a function` (or import error), because `server.js` does not export it yet.

- [ ] **Step 4: Refactor `server.js` to export `attachRelay(io)` and add the two handlers**

In `server.js`, extract the `io.on('connection', ...)` wiring into an exported function, and add the `intent` and `hud` relays alongside the existing `msg` handler. Replace the section from `io.on('connection', (socket) => {` through its closing `});` with a call, and define:

```js
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
```

Then, guard the server startup so importing the module in tests does not bind a port. Wrap the existing `app`/`io`/`server.listen(...)` bootstrap in:

```js
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
    pingInterval: 10000, pingTimeout: 5000, maxHttpBufferSize: 1e6,
  });

  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/read', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'read.html')));
  app.get('/show', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'show.html')));

  attachRelay(io);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  AirControl running on http://localhost:${PORT}`);
    console.log(`  Open /show on your laptop, /read on your phone.\n`);
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — both relay tests green.

- [ ] **Step 6: Sanity-check the server still boots**

Run: `node server.js`
Expected: prints "AirControl running on http://localhost:3000". Stop with Ctrl-C.

- [ ] **Step 7: Commit**

```bash
git add server.js package.json package-lock.json test/relay.test.js
git commit -m "feat(relay): add intent and hud message relay + test harness"
```

---

### Task 2: Glasses app — intent mapping module

**Files:**
- Create: `public/glasses/js/intentMap.js`
- Create: `test/intentMap.test.js`

**Interfaces:**
- Produces: `IntentMap.keyToIntent(key: string) → 'next' | 'prev' | 'scroll-up' | 'scroll-down' | null`. Used by `glassesClient.js` (Task 4) to convert Neural Band keyboard events into actions.

- [ ] **Step 1: Write the failing test**

Create `test/intentMap.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { keyToIntent } = require('../public/glasses/js/intentMap.js');

test('Enter and ArrowRight map to next', () => {
  assert.strictEqual(keyToIntent('Enter'), 'next');
  assert.strictEqual(keyToIntent('ArrowRight'), 'next');
});

test('ArrowLeft maps to prev', () => {
  assert.strictEqual(keyToIntent('ArrowLeft'), 'prev');
});

test('ArrowUp/ArrowDown map to scroll', () => {
  assert.strictEqual(keyToIntent('ArrowUp'), 'scroll-up');
  assert.strictEqual(keyToIntent('ArrowDown'), 'scroll-down');
});

test('unknown keys map to null', () => {
  assert.strictEqual(keyToIntent('a'), null);
  assert.strictEqual(keyToIntent(''), null);
  assert.strictEqual(keyToIntent(undefined), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/intentMap.test.js`
Expected: FAIL — cannot find module `intentMap.js`.

- [ ] **Step 3: Write the module (UMD footer for dual browser/Node use)**

Create `public/glasses/js/intentMap.js`:

```js
/**
 * intentMap.js — pure mapping from Neural Band keyboard events to presenter intents.
 * Meta Ray-Ban Display delivers Neural Band gestures as keyboard events:
 *   pinch/tap → Enter, swipes → Arrow keys.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IntentMap = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function keyToIntent(key) {
    switch (key) {
      case 'Enter':
      case 'ArrowRight': return 'next';
      case 'ArrowLeft':  return 'prev';
      case 'ArrowUp':    return 'scroll-up';
      case 'ArrowDown':  return 'scroll-down';
      default:           return null;
    }
  }
  return { keyToIntent };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/intentMap.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/glasses/js/intentMap.js test/intentMap.test.js
git commit -m "feat(glasses): add Neural Band key→intent mapping"
```

---

### Task 3: Glasses app — HUD formatting module

**Files:**
- Create: `public/glasses/js/hudView.js`
- Create: `test/hudView.test.js`

**Interfaces:**
- Produces: `HudView.formatHud(state: {index, total, notes, startedAt}, now: number) → {slideLabel: string, timerLabel: string, notes: string}`. Pure — no DOM. `glassesClient.js` (Task 4) calls this then writes the strings into the DOM. `now` is epoch-ms (injected so the function stays pure/testable).

- [ ] **Step 1: Write the failing test**

Create `test/hudView.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { formatHud } = require('../public/glasses/js/hudView.js');

test('formats slide label as 1-based index / total', () => {
  const out = formatHud({ index: 0, total: 12, notes: 'x', startedAt: 0 }, 0);
  assert.strictEqual(out.slideLabel, '1 / 12');
});

test('formats elapsed timer as mm:ss from startedAt to now', () => {
  const out = formatHud({ index: 0, total: 1, notes: '', startedAt: 1000 }, 1000 + 65_000);
  assert.strictEqual(out.timerLabel, '01:05');
});

test('clamps negative elapsed to 00:00', () => {
  const out = formatHud({ index: 0, total: 1, notes: '', startedAt: 5000 }, 1000);
  assert.strictEqual(out.timerLabel, '00:00');
});

test('passes notes through, defaulting empty to a placeholder', () => {
  assert.strictEqual(formatHud({ index: 0, total: 1, notes: 'hi', startedAt: 0 }, 0).notes, 'hi');
  assert.strictEqual(formatHud({ index: 0, total: 1, notes: '', startedAt: 0 }, 0).notes, '(no notes for this slide)');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/hudView.test.js`
Expected: FAIL — cannot find module `hudView.js`.

- [ ] **Step 3: Write the module**

Create `public/glasses/js/hudView.js`:

```js
/**
 * hudView.js — pure formatting of relay `hud` state into HUD display strings.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HudView = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function two(n) { return String(n).padStart(2, '0'); }

  function formatHud(state, now) {
    const index = state && Number.isFinite(state.index) ? state.index : 0;
    const total = state && Number.isFinite(state.total) ? state.total : 0;
    const startedAt = state && Number.isFinite(state.startedAt) ? state.startedAt : now;

    const elapsedMs = Math.max(0, now - startedAt);
    const totalSec = Math.floor(elapsedMs / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;

    const notes = state && state.notes ? state.notes : '(no notes for this slide)';

    return {
      slideLabel: `${index + 1} / ${total}`,
      timerLabel: `${two(mm)}:${two(ss)}`,
      notes,
    };
  }
  return { formatHud };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/hudView.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/glasses/js/hudView.js test/hudView.test.js
git commit -m "feat(glasses): add HUD state formatting"
```

---

### Task 4: Glasses app — client shell, WebSocket wiring, pairing, and route

**Files:**
- Create: `public/glasses/js/miniSocket.js` (port of the extension's `MiniSocketIO`, exposed as `window.MiniSocketIO`)
- Create: `public/glasses/index.html` (600×600 HUD + pairing screen)
- Create: `public/glasses/js/glassesClient.js` (wires miniSocket + IntentMap + HudView)
- Modify: `server.js` (add `/glasses` convenience route inside the `require.main === module` block)

**Interfaces:**
- Consumes: `IntentMap.keyToIntent` (Task 2), `HudView.formatHud` (Task 3), relay events `intent`/`hud` (Task 1), room helpers `SG_CONFIG.getRoomFromURL` from existing `public/js/config.js`.
- Produces: a running web app that (a) joins a room as a **reader** (`join-room`), (b) emits `intent` on Neural Band keys, (c) renders incoming `hud`. Room code is persisted in `localStorage` under key `aircontrol.room`.

- [ ] **Step 1: Port the MiniSocketIO client for the browser app**

Create `public/glasses/js/miniSocket.js` by copying the `MiniSocketIO` class from `chrome-extension/background.js` (lines 15-133) verbatim, and appending a browser global export at the end:

```js
// ... (exact MiniSocketIO class body copied from chrome-extension/background.js) ...

if (typeof window !== 'undefined') window.MiniSocketIO = MiniSocketIO;
```

Note: this is a deliberate, isolated copy — the extension's service worker cannot share a module with a web app served from a different origin. Keep the class body byte-identical so fixes can be mirrored.

- [ ] **Step 2: Build the HUD + pairing HTML**

Create `public/glasses/index.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=600, height=600" />
  <title>AirControl — Presenter HUD</title>
  <style>
    html, body { margin: 0; width: 600px; height: 600px; background: #000; color: #fff;
      font-family: system-ui, sans-serif; overflow: hidden; }
    .screen { display: none; width: 100%; height: 100%; box-sizing: border-box; padding: 24px; }
    .screen.active { display: flex; flex-direction: column; }
    /* Pairing */
    #pairing .code { font-size: 64px; letter-spacing: 8px; text-align: center; margin: 24px 0; }
    #pairing .hint { opacity: 0.7; text-align: center; }
    /* HUD */
    #hud .top { display: flex; justify-content: space-between; font-size: 28px; font-weight: 700; }
    #hud .status { font-size: 16px; opacity: 0.7; }
    #hud .status.ok { color: #35c46a; }
    #hud .notes { flex: 1; margin-top: 16px; font-size: 24px; line-height: 1.4;
      overflow-y: auto; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div id="pairing" class="screen active">
    <div class="hint">AirControl — enter room code on the laptop</div>
    <div class="code" id="pair-code">------</div>
    <div class="hint" id="pair-status">Waiting to connect…</div>
    <div class="hint">Swipe left/right to change a digit · pinch to confirm</div>
  </div>

  <div id="hud" class="screen">
    <div class="top">
      <span id="hud-slide">– / –</span>
      <span id="hud-timer">00:00</span>
    </div>
    <div class="status" id="hud-status">connecting…</div>
    <div class="notes" id="hud-notes">(no notes for this slide)</div>
  </div>

  <script src="/js/config.js"></script>
  <script src="js/miniSocket.js"></script>
  <script src="js/intentMap.js"></script>
  <script src="js/hudView.js"></script>
  <script src="js/glassesClient.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write the client wiring**

Create `public/glasses/js/glassesClient.js`:

```js
/**
 * glassesClient.js — Ray-Ban Display presenter web app.
 * Joins a relay room as a reader, emits `intent` from Neural Band keys,
 * renders incoming `hud` state. Neural Band arrives as keyboard events.
 */
(function () {
  const SERVER_URL = location.origin;      // served from the same host
  const ROOM_KEY = 'aircontrol.room';
  const CODE_LEN = 6;
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const $ = (id) => document.getElementById(id);
  let socket = null;
  let lastHud = null;

  // ── Pairing state (simple D-pad code editor) ──────────────────────────────
  const saved = localStorage.getItem(ROOM_KEY);
  let code = (SG_CONFIG.getRoomFromURL() || saved || ALPHABET[0].repeat(CODE_LEN)).toUpperCase();
  let cursor = 0;

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(id).classList.add('active');
  }
  function renderPairing() {
    $('pair-code').textContent = code;
  }

  function connect() {
    localStorage.setItem(ROOM_KEY, code);
    socket = new MiniSocketIO(SERVER_URL);
    socket.on('connect', () => {
      socket.emit('join-room', code, (resp) => {
        if (resp && resp.ok) {
          showScreen('hud');
          setStatus('connected', true);
        } else {
          $('pair-status').textContent = 'Room not found — check the code';
        }
      });
    });
    socket.on('hud', (data) => { lastHud = data; renderHud(); });
    socket.on('room-closed', () => setStatus('presenter left', false));
    socket.on('disconnect', () => setStatus('disconnected', false));
    socket.connect();
  }

  function setStatus(text, ok) {
    const el = $('hud-status');
    el.textContent = text;
    el.classList.toggle('ok', !!ok);
  }

  function renderHud() {
    if (!lastHud) return;
    const out = HudView.formatHud(lastHud, Date.now());
    $('hud-slide').textContent = out.slideLabel;
    $('hud-timer').textContent = out.timerLabel;
    $('hud-notes').textContent = out.notes;
  }
  // Keep the timer ticking even without new hud messages.
  setInterval(renderHud, 1000);

  // ── Input handling ────────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    const onPairing = $('pairing').classList.contains('active');
    if (onPairing) return handlePairingKey(e);
    handleHudKey(e);
  });

  function handlePairingKey(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const i = ALPHABET.indexOf(code[cursor]);
      const next = (i + delta + ALPHABET.length) % ALPHABET.length;
      code = code.slice(0, cursor) + ALPHABET[next] + code.slice(cursor + 1);
      renderPairing();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      cursor = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + CODE_LEN) % CODE_LEN;
    } else if (e.key === 'Enter') {
      $('pair-status').textContent = 'Connecting…';
      connect();
    }
  }

  function handleHudKey(e) {
    const intent = IntentMap.keyToIntent(e.key);
    if (!intent) return;
    if (intent === 'next' || intent === 'prev') {
      if (socket) socket.emit('intent', { action: intent });
    } else if (intent === 'scroll-up' || intent === 'scroll-down') {
      $('hud-notes').scrollBy({ top: intent === 'scroll-down' ? 120 : -120 });
    }
  }

  renderPairing();
  showScreen('pairing');
})();
```

- [ ] **Step 4: Add the `/glasses` route to the server**

Inside the `if (require.main === module) {` block in `server.js`, add next to the other routes:

```js
  app.get('/glasses', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'glasses', 'index.html')));
```

(The `public/glasses/` folder is already served by `express.static`; this route just gives a clean `/glasses` URL.)

- [ ] **Step 5: Run the unit tests to confirm nothing regressed**

Run: `npm test`
Expected: PASS — relay, intentMap, hudView tests all green (no test added here; this is a manual-validation task).

- [ ] **Step 6: Manual validation in a desktop browser (Meta's simulation flow)**

1. Start the server: `node server.js`.
2. Open `http://localhost:3000/show` in one tab — note its room code.
3. Open `http://localhost:3000/glasses?room=<CODE>` in a second tab, focus it, press **Enter**.
   Expected: switches to the HUD screen, status shows green "connected".
4. In a third terminal, publish a `hud` message to that room to confirm rendering. Quick way: open the browser devtools console on the `/glasses` tab and run:
   ```js
   // simulate a hud message locally to verify rendering wiring
   document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })); // notes scroll
   ```
   Expected: no errors; scroll handler runs. (Full round-trip `hud` rendering is validated end-to-end in Task 7.)
5. With the HUD focused, press **Enter** and **ArrowLeft**.
   Expected: devtools Network/console shows `intent` frames being emitted (add a temporary `console.log` in `handleHudKey` if needed, then remove it).

- [ ] **Step 7: Commit**

```bash
git add public/glasses/ server.js
git commit -m "feat(glasses): presenter HUD web app with pairing and intent emit"
```

---

### Task 5: Extension — consume `intent` to drive slides

**Files:**
- Modify: `chrome-extension/background.js` (register an `intent` handler in `startListening`)

**Interfaces:**
- Consumes: relay `intent` event `{ action: 'next' | 'prev' }`.
- Produces: reuses the existing `sendToActiveTab({ type: 'slide-action', action })` path, so `content.js` dispatches `ArrowRight`/`ArrowLeft` exactly as today. Honors the existing `currentConfig.swapHands`.

- [ ] **Step 1: Add the `intent` handler**

In `chrome-extension/background.js`, inside `startListening()` next to the existing `socket.on('hand', ...)` block, add:

```js
  socket.on('intent', (data) => {
    let action = data && data.action === 'prev' ? 'prev' : 'next';
    if (currentConfig.swapHands) action = action === 'next' ? 'prev' : 'next';
    console.log('[bg] intent received:', action);
    sendToActiveTab({ type: 'slide-action', action });
  });
```

- [ ] **Step 2: Manual validation**

1. Load the extension (`chrome://extensions` → Developer mode → Load unpacked → `chrome-extension/`).
2. Open Google Slides in presentation mode; click the extension, enter server `http://localhost:3000` and a room code, click **Start**. The extension creates the room (as viewer).
3. Open `http://localhost:3000/glasses?room=<SAME CODE>` in another tab, focus it, press **Enter** to connect.
4. With the `/glasses` tab focused, press **Enter**.
   Expected: the Google Slides deck advances one slide; the extension overlay flashes "Next slide".
5. Press **ArrowLeft** in the `/glasses` tab.
   Expected: the deck goes back one slide.

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/background.js
git commit -m "feat(extension): drive slides from glasses intent messages"
```

---

### Task 6: Extension — scrape Google Slides notes and push `hud`

**Files:**
- Create: `chrome-extension/notesExtractor.js`
- Create: `test/notesExtractor.test.js`
- Modify: `chrome-extension/manifest.json` (load `notesExtractor.js` before `content.js`)
- Modify: `chrome-extension/content.js` (poll slide state, emit `hud` on change)
- Modify: `chrome-extension/background.js` (forward `hud` from content script into the room)

**Interfaces:**
- Produces:
  - `NotesExtractor.readSlideState(doc) → { index, total, notes } | null` — pure-ish DOM read from Google Slides **Presenter View**. Returns `null` when the expected elements are absent (e.g. not in presenter view).
  - `NotesExtractor.hasChanged(prev, next) → boolean` — true when `index` or `notes` differ. Pure; unit-tested.
- Consumes (content.js): sends `{ type: 'hud-out', payload: { index, total, notes, startedAt } }` to the background via `chrome.runtime.sendMessage`.
- Consumes (background.js): on `hud-out`, calls `socket.emit('hud', payload)`.

- [ ] **Step 1: Write the failing test for the pure change-detection logic**

Create `test/notesExtractor.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { hasChanged } = require('../chrome-extension/notesExtractor.js');

test('hasChanged is true when index differs', () => {
  assert.strictEqual(hasChanged({ index: 0, notes: 'a' }, { index: 1, notes: 'a' }), true);
});
test('hasChanged is true when notes differ', () => {
  assert.strictEqual(hasChanged({ index: 2, notes: 'a' }, { index: 2, notes: 'b' }), true);
});
test('hasChanged is false when index and notes match', () => {
  assert.strictEqual(hasChanged({ index: 2, notes: 'a' }, { index: 2, notes: 'a' }), false);
});
test('hasChanged is true when prev is null', () => {
  assert.strictEqual(hasChanged(null, { index: 0, notes: 'a' }), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/notesExtractor.test.js`
Expected: FAIL — cannot find module `notesExtractor.js`.

- [ ] **Step 3: Write the extractor module**

Create `chrome-extension/notesExtractor.js`:

```js
/**
 * notesExtractor.js — reads current slide index/total/notes from
 * Google Slides Presenter View, and detects meaningful changes.
 *
 * Presenter View DOM (as of 2026) exposes:
 *   • speaker notes text under `.punch-viewer-speakernotes-textview` (rich text)
 *   • the "N of M" position in the presenter toolbar.
 * Selectors are intentionally isolated here so DOM changes are a one-file fix.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NotesExtractor = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Selectors kept together for easy maintenance.
  const SEL_NOTES = '.punch-viewer-speakernotes-textview';
  const SEL_POSITION = '.punch-viewer-navbar-slidecount, [aria-label*="of"]';

  function readSlideState(doc) {
    const notesEl = doc.querySelector(SEL_NOTES);
    if (!notesEl) return null; // not in presenter view
    const notes = (notesEl.innerText || notesEl.textContent || '').trim();

    let index = 0, total = 0;
    const posEl = doc.querySelector(SEL_POSITION);
    const text = posEl ? (posEl.getAttribute('aria-label') || posEl.textContent || '') : '';
    const m = text.match(/(\d+)\s*(?:of|\/)\s*(\d+)/i);
    if (m) { index = parseInt(m[1], 10) - 1; total = parseInt(m[2], 10); }

    return { index, total, notes };
  }

  function hasChanged(prev, next) {
    if (!prev) return true;
    return prev.index !== next.index || prev.notes !== next.notes;
  }

  return { readSlideState, hasChanged };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/notesExtractor.test.js`
Expected: PASS.

- [ ] **Step 5: Register the extractor in the manifest**

In `chrome-extension/manifest.json`, change the content-script `js` array so the extractor loads first:

```json
      "js": ["notesExtractor.js", "content.js"],
```

- [ ] **Step 6: Wire polling + emit into `content.js`**

Append to the end of `chrome-extension/content.js` (inside the existing IIFE, before its closing `})();`):

```js
  // ── Teleprompter: poll Presenter View and push HUD state ──────────────────
  let _prevState = null;
  let _startedAt = Date.now();

  setInterval(() => {
    const state = NotesExtractor.readSlideState(document);
    if (!state) return;                       // not presenter view — nothing to send
    if (!NotesExtractor.hasChanged(_prevState, state)) return;
    _prevState = state;
    chrome.runtime.sendMessage({
      type: 'hud-out',
      payload: { index: state.index, total: state.total, notes: state.notes, startedAt: _startedAt },
    }).catch(() => {});
  }, 700);
```

- [ ] **Step 7: Forward `hud-out` to the room in `background.js`**

In `chrome-extension/background.js`, add a case to the `chrome.runtime.onMessage` listener (the `switch (msg.type)` block):

```js
    case 'hud-out':
      if (socket && socket.connected) socket.emit('hud', msg.payload);
      sendResponse({ ok: true });
      return true;
```

- [ ] **Step 8: Run the full unit suite**

Run: `npm test`
Expected: PASS — relay, intentMap, hudView, notesExtractor all green.

- [ ] **Step 9: Manual validation against real Google Slides Presenter View**

1. Reload the extension.
2. In Google Slides, start the show in **Presenter View** (Slideshow ▸ Presenter view), so the notes pane is present in the tab's DOM.
3. Start the extension in that room; connect the `/glasses` tab to the same room.
   Expected: the HUD shows the current slide's speaker notes, `N / M` slide label, and a running timer.
4. Advance a slide (from the `/glasses` tab via **Enter**).
   Expected: within ~1s the HUD notes update to the new slide's notes.
5. If notes do not appear, open the Presenter View tab's devtools and run `document.querySelector('.punch-viewer-speakernotes-textview')` — if `null`, update `SEL_NOTES`/`SEL_POSITION` in `notesExtractor.js` to match the current DOM (this is the expected iteration point called out in the spec's risk #1).

- [ ] **Step 10: Commit**

```bash
git add chrome-extension/notesExtractor.js chrome-extension/content.js chrome-extension/background.js chrome-extension/manifest.json test/notesExtractor.test.js
git commit -m "feat(extension): scrape Presenter View notes and push HUD state"
```

---

### Task 7: End-to-end validation and documentation

**Files:**
- Create: `public/glasses/README.md`
- Modify: `README.md` (mark the glasses milestone in progress / document the flow)

**Interfaces:** none (integration + docs).

- [ ] **Step 1: Full end-to-end dry run (no glasses required)**

1. `node server.js`.
2. Google Slides open in **Presenter View**; extension started in room `<CODE>` (as viewer).
3. `http://localhost:3000/glasses?room=<CODE>` focused; press **Enter** to connect.
4. Verify the loop:
   - Press **Enter** on the glasses tab → deck advances → HUD notes/label update within ~1s.
   - Press **ArrowLeft** → deck goes back → HUD updates.
   - Press **ArrowUp/ArrowDown** → HUD notes scroll.
   - The HUD timer increments every second.
   Expected: all four behaviors work. Record any selector fixes made to `notesExtractor.js`.

- [ ] **Step 2: Write the glasses-app README**

Create `public/glasses/README.md` documenting: purpose, the `intent`/`hud` contracts, the gesture mapping table, how to install on Ray-Ban Display (add `https://<host>/glasses` as a Web App in the Meta AI phone app, then pair by entering the extension's room code with swipe-to-change / pinch-to-confirm), and that development is tested in a browser using arrow keys + Enter.

- [ ] **Step 3: Update the top-level README status**

In `README.md`, update the Status checklist to reflect glasses presenter control + teleprompter as in progress/done, and add a one-line description of the glasses flow under Overview.

- [ ] **Step 4: On-device validation (when hardware is available)**

Deploy the server so `/glasses` is reachable over public HTTPS (the existing `render.yaml` already deploys the server; confirm `/glasses` loads). Add the URL as a Web App on the Ray-Ban Display, pair to the room, and confirm: pinch advances slides, notes/timer render legibly in the 600×600 HUD, and reconnect works after the glasses sleep/wake. Note any latency or legibility fixes as follow-ups.

- [ ] **Step 5: Commit**

```bash
git add public/glasses/README.md README.md
git commit -m "docs: document Ray-Ban Display presenter flow and setup"
```

---

## Self-Review

**Spec coverage:**
- Hands-free slide control → Tasks 4 (intent emit) + 5 (extension consumes). ✓
- Private teleprompter (slide #, timer, notes) → Tasks 3 (formatting) + 4 (render) + 6 (notes source). ✓
- Reuse relay seam with `intent`/`hud` → Task 1. ✓
- Neural Band = keyboard events → Tasks 2, 4. ✓
- Notes from Google Slides Presenter View (ground-truth index, not keypress counting) → Task 6. ✓
- Served from existing server over HTTPS, `/glasses` route → Task 4. ✓
- Room pairing persisted + D-pad entry → Task 4. ✓
- WebSocket-client risk resolved by porting `MiniSocketIO` (no `socket.io-client` at runtime) → Task 4. ✓
- Error handling (disconnect/room-closed/notes-missing/index-drift) → Tasks 4, 6. ✓
- Testing via browser key simulation → Tasks 4–7 manual steps. ✓
- Non-goals (camera/voice/general desktop/non-Google) → not built. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; manual steps state exact expected outcomes.

**Type consistency:** `intent {action}` and `hud {index,total,notes,startedAt}` are used identically across Tasks 1, 4, 5, 6. `keyToIntent`, `formatHud`, `readSlideState`, `hasChanged` signatures match between their defining task and their callers. `index` is 0-based everywhere; `formatHud` renders it 1-based for display only.
