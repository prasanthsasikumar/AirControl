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
    if (socket) { socket.disconnect(); }
    const s = new MiniSocketIO(SERVER_URL);
    socket = s;
    s.on('connect', () => {
      if (socket !== s) return;
      s.emit('join-room', code, (resp) => {
        if (socket !== s) return;
        if (resp && resp.ok) {
          localStorage.setItem(ROOM_KEY, code);
          showScreen('hud');
          setStatus('connected', true);
        } else {
          $('pair-status').textContent = 'Room not found — check the code';
        }
      });
    });
    s.on('hud', (data) => {
      if (socket !== s) return;
      lastHud = data;
      renderHud();
    });
    s.on('room-closed', () => {
      if (socket !== s) return;
      setStatus('presenter left', false);
    });
    s.on('disconnect', () => {
      if (socket !== s) return;
      setStatus('disconnected', false);
    });
    s.connect();
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
