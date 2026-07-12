/**
 * renderer.js — SpatialGrip Desktop UI logic
 */

const DEFAULT_SERVER = 'https://aircontrol.flowsxr.com';

const serverUrlEl = document.getElementById('server-url');
const roomCodeEl = document.getElementById('room-code');
const qrCodeEl = document.getElementById('qr-code');
const startBtn = document.getElementById('start-btn');
const regenerateBtn = document.getElementById('regenerate-btn');
const statusEl = document.getElementById('status');
const settingsToggle = document.getElementById('settings-toggle');
const settingsContent = document.getElementById('settings-content');
const swapHandsEl = document.getElementById('swap-hands');
const rightLabelEl = document.getElementById('right-label');
const leftLabelEl = document.getElementById('left-label');

let active = false;
let currentRoomCode = '';
let swapHands = false;

// ── Generate room code ────────────────────────────────────────────────────────
function generateRoomCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < len; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── Update room display ───────────────────────────────────────────────────────
function updateRoomDisplay(roomCode) {
  currentRoomCode = roomCode;
  roomCodeEl.textContent = roomCode;

  const serverUrl = serverUrlEl.value.trim() || DEFAULT_SERVER;
  const joinURL = `${serverUrl}/read?room=${roomCode}`;
  const qrURL = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(joinURL)}&bgcolor=ffffff&color=000000`;
  
  qrCodeEl.src = qrURL;
  qrCodeEl.alt = joinURL;
  qrCodeEl.title = joinURL;
}

// ── Update gesture labels ─────────────────────────────────────────────────────
function updateGestureLabels() {
  if (swapHands) {
    rightLabelEl.textContent = 'Previous slide';
    leftLabelEl.textContent = 'Next slide';
  } else {
    rightLabelEl.textContent = 'Next slide';
    leftLabelEl.textContent = 'Previous slide';
  }
}

// ── Initialize ────────────────────────────────────────────────────────────────
function init() {
  const roomCode = generateRoomCode();
  updateRoomDisplay(roomCode);
  updateGestureLabels();
  
  // Get current status from main process
  window.spatialgrip.getStatus().then((resp) => {
    if (resp) {
      active = resp.active;
      updateUI(resp.active, resp.readerConnected);
    }
  });
}

init();

// ── Listen for status updates ─────────────────────────────────────────────────
window.spatialgrip.onStatusUpdate((data) => {
  active = data.active;
  updateUI(data.active, data.readerConnected);
});

// ── Start / Stop button ───────────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  if (active) {
    await window.spatialgrip.stop();
    active = false;
    updateUI(false, false);
  } else {
    const serverUrl = serverUrlEl.value.trim() || DEFAULT_SERVER;
    if (!currentRoomCode) {
      currentRoomCode = generateRoomCode();
      updateRoomDisplay(currentRoomCode);
    }

    await window.spatialgrip.start({
      serverUrl,
      roomCode: currentRoomCode,
      swapHands
    });
    
    active = true;
    updateUI(true, false);
  }
});

// ── Regenerate button ─────────────────────────────────────────────────────────
regenerateBtn.addEventListener('click', async () => {
  const newCode = generateRoomCode();
  updateRoomDisplay(newCode);

  if (active) {
    // Restart with new room
    await window.spatialgrip.stop();
    const serverUrl = serverUrlEl.value.trim() || DEFAULT_SERVER;
    await window.spatialgrip.start({
      serverUrl,
      roomCode: newCode,
      swapHands
    });
    active = true;
    updateUI(true, false);
  }
});

// ── Copy room code ────────────────────────────────────────────────────────────
roomCodeEl.addEventListener('click', () => {
  navigator.clipboard.writeText(currentRoomCode).then(() => {
    const original = roomCodeEl.textContent;
    roomCodeEl.textContent = '✓ Copied!';
    setTimeout(() => {
      roomCodeEl.textContent = original;
    }, 1000);
  });
});

// ── Settings toggle ───────────────────────────────────────────────────────────
settingsToggle.addEventListener('click', () => {
  settingsContent.classList.toggle('visible');
  const isVisible = settingsContent.classList.contains('visible');
  settingsToggle.textContent = isVisible ? '▼ Settings' : '⚙️ Settings';
});

// ── Server URL change ─────────────────────────────────────────────────────────
serverUrlEl.addEventListener('change', () => {
  updateRoomDisplay(currentRoomCode);
});

// ── Swap hands checkbox ───────────────────────────────────────────────────────
swapHandsEl.addEventListener('change', () => {
  swapHands = swapHandsEl.checked;
  updateGestureLabels();
  
  if (active) {
    window.spatialgrip.updateSwapHands(swapHands);
  }
});

// ── Update UI ─────────────────────────────────────────────────────────────────
function updateUI(isActive, isConnected) {
  startBtn.textContent = isActive ? 'Stop Listening' : 'Start Listening';
  startBtn.classList.toggle('active', isActive);

  serverUrlEl.disabled = isActive;
  regenerateBtn.disabled = isActive;

  const label = isConnected
    ? 'Connected ✓'
    : isActive
      ? 'Connecting…'
      : 'Not connected';

  statusEl.innerHTML = `<span class="dot"></span> ${label}`;
  statusEl.className = 'status' + (isConnected ? ' connected' : '');
}
