/**
 * glassesClient.js — AirControl presenter web app (Ray-Ban Display, or a phone
 * standing in for the glasses during testing).
 *
 * Joins a relay room as a reader, emits `intent` from Neural Band keys OR touch
 * taps, renders incoming `hud` state, and auto-reconnects on drops.
 */
(function () {
  const SERVER_URL = location.origin;      // served from the same host
  const ROOM_KEY = 'aircontrol.room';
  const CODE_LEN = 6;
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const RECONNECT_MIN = 1000;              // ms
  const RECONNECT_MAX = 15000;             // ms (backoff ceiling)

  const $ = (id) => document.getElementById(id);
  let socket = null;
  let lastHud = null;

  let active = false;        // user has initiated a connection — keep (re)trying until connected
  let connected = false;     // currently joined to a room
  let reconnectTimer = null;
  let backoff = RECONNECT_MIN;

  // ── Pairing state (D-pad code editor) ──────────────────────────────────────
  const urlRoom = SG_CONFIG.getRoomFromURL();
  const saved = localStorage.getItem(ROOM_KEY);
  let code = (urlRoom || saved || ALPHABET[0].repeat(CODE_LEN)).toUpperCase();
  let cursor = 0;

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(id).classList.add('active');
  }
  function renderPairing() {
    const el = $('pair-code');
    el.innerHTML = '';
    for (let i = 0; i < code.length; i++) {
      const slot = document.createElement('span');
      slot.className = 'slot' + (i === cursor ? ' slot-active' : '');
      slot.textContent = code[i];
      el.appendChild(slot);
    }
  }

  // Status is shown on both the pairing and HUD screens so it's always visible.
  function setStatus(text, ok) {
    const hud = $('hud-status');
    hud.textContent = text;
    hud.classList.toggle('ok', !!ok);
    const pair = $('pair-status');
    if (pair) pair.textContent = text;
  }

  // ── Connection + auto-reconnect ────────────────────────────────────────────
  function connect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (socket) { socket.disconnect(); }
    const s = new MiniSocketIO(SERVER_URL);
    socket = s;

    s.on('connect', () => {
      if (socket !== s) return;
      s.emit('join-room', code, (resp) => {
        if (socket !== s) return;
        if (resp && resp.ok) {
          localStorage.setItem(ROOM_KEY, code);
          connected = true;
          backoff = RECONNECT_MIN;
          showScreen('hud');
          setStatus('connected', true);
        } else {
          connected = false;
          setStatus('waiting for presenter…', false);
          scheduleReconnect();
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
      connected = false;
      setStatus('presenter left — waiting…', false);
      scheduleReconnect();
    });
    s.on('disconnect', () => {
      if (socket !== s) return;
      connected = false;
      setStatus('reconnecting…', false);
      scheduleReconnect();
    });
    s.connect();
  }

  function scheduleReconnect() {
    if (!active || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoff);
    backoff = Math.min(backoff * 2, RECONNECT_MAX);   // exponential backoff
  }

  // Recover promptly when the tab/app returns to the foreground or the network comes back.
  function reconnectNow() {
    if (!active || connected) return;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    backoff = RECONNECT_MIN;
    connect();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reconnectNow(); });
  window.addEventListener('online', reconnectNow);

  // ── HUD rendering ──────────────────────────────────────────────────────────
  function renderHud() {
    if (!lastHud) return;
    const out = HudView.formatHud(lastHud, Date.now());
    $('hud-slide').textContent = out.slideLabel;
    $('hud-timer').textContent = out.timerLabel;
    $('hud-notes').textContent = out.notes;
  }
  // Keep the timer ticking even without new hud messages.
  setInterval(renderHud, 1000);

  // ── Intent + input ─────────────────────────────────────────────────────────
  function sendIntent(action) {
    if (socket && socket.connected) socket.emit('intent', { action });
  }

  document.addEventListener('keydown', (e) => {
    const onPairing = $('pairing').classList.contains('active');
    if (onPairing) return handlePairingKey(e);
    handleHudKey(e);
  });

  function handlePairingKey(e) {
    // Left/right move between slots; up/down cycle the highlighted character.
    const next = Pairing.applyKey({ code, cursor }, e.key, ALPHABET);
    code = next.code;
    cursor = next.cursor;
    renderPairing();
    if (next.submit) startConnecting();
  }

  function handleHudKey(e) {
    const intent = IntentMap.keyToIntent(e.key);
    if (!intent) return;
    if (intent === 'next' || intent === 'prev') {
      sendIntent(intent);
    } else if (intent === 'scroll-up' || intent === 'scroll-down') {
      $('hud-notes').scrollBy({ top: intent === 'scroll-down' ? 120 : -120 });
    }
  }

  // Touch: invisible edge tap-zones let a phone drive prev/next (stand-in for the
  // Neural Band). On non-touch devices (real glasses) the zones stay hidden.
  const tapPrev = $('tap-prev');
  const tapNext = $('tap-next');
  if (tapPrev) tapPrev.addEventListener('click', () => sendIntent('prev'));
  if (tapNext) tapNext.addEventListener('click', () => sendIntent('next'));
  if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
    document.body.classList.add('touch');
  }

  function startConnecting() {
    active = true;
    setStatus('connecting…', false);
    connect();
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  renderPairing();
  showScreen('pairing');
  if (urlRoom) startConnecting();   // room supplied in the URL → connect straight away
})();
