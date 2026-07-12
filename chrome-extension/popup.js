/**
 * popup.js — SpatialGrip Chrome Extension popup logic
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
const rightActionEl = document.getElementById('right-action');
const rightLabelEl = document.getElementById('right-label');
const leftActionEl = document.getElementById('left-action');
const leftLabelEl = document.getElementById('left-label');

let active = false;
let currentRoomCode = '';
let swapHands = false;

// ── Generate room code ────────────────────────────────────────────────────────
function generateRoomCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
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
  const qrURL = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(joinURL)}&bgcolor=ffffff&color=000000`;
  
  qrCodeEl.src = qrURL;
  qrCodeEl.alt = joinURL;
  qrCodeEl.title = joinURL;
}

// ── Update gesture labels based on swap setting ───────────────────────────────
function updateGestureLabels() {
  if (swapHands) {
    rightLabelEl.textContent = 'Previous slide';
    leftLabelEl.textContent = 'Next slide';
  } else {
    rightLabelEl.textContent = 'Next slide';
    leftLabelEl.textContent = 'Previous slide';
  }
}

// ── Initialize: restore or generate room code ─────────────────────────────────
chrome.storage.local.get('config', (res) => {
  if (res.config) {
    serverUrlEl.value = res.config.serverUrl || DEFAULT_SERVER;
    swapHands = res.config.swapHands || false;
    swapHandsEl.checked = swapHands;
    updateGestureLabels();
    
    if (res.config.roomCode && res.config.roomCode.length >= 4) {
      updateRoomDisplay(res.config.roomCode);
    } else {
      updateRoomDisplay(generateRoomCode());
    }
  } else {
    updateRoomDisplay(generateRoomCode());
  }
});

// ── Get current status from background ────────────────────────────────────────
chrome.runtime.sendMessage({ type: 'get-status' }, (resp) => {
  if (chrome.runtime.lastError) return;
  if (resp) {
    active = resp.active;
    updateUI(resp.active, resp.readerConnected);
  }
});

// ── Start / Stop button ───────────────────────────────────────────────────────
startBtn.addEventListener('click', () => {
  if (active) {
    chrome.runtime.sendMessage({ type: 'stop' }, () => {
      active = false;
      updateUI(false, false);
    });
  } else {
    const serverUrl = serverUrlEl.value.trim() || DEFAULT_SERVER;
    if (!currentRoomCode) {
      currentRoomCode = generateRoomCode();
      updateRoomDisplay(currentRoomCode);
    }

    // Save config to storage
    chrome.storage.local.set({
      config: { serverUrl, roomCode: currentRoomCode, swapHands }
    });

    chrome.runtime.sendMessage(
      { type: 'start', config: { serverUrl, roomCode: currentRoomCode, swapHands } },
      () => {
        active = true;
        updateUI(true, false);
        // Wait a moment then re-check connection
        setTimeout(refreshStatus, 1500);
      },
    );
  }
});

// ── Regenerate room code button ───────────────────────────────────────────────
regenerateBtn.addEventListener('click', () => {
  const newCode = generateRoomCode();
  updateRoomDisplay(newCode);
  
  // Save new room code to storage
  chrome.storage.local.get('config', (res) => {
    const config = res.config || {};
    config.roomCode = newCode;
    chrome.storage.local.set({ config });
  });

  if (active) {
    // Stop current connection and restart with new room
    chrome.runtime.sendMessage({ type: 'stop' }, () => {
      const serverUrl = serverUrlEl.value.trim() || DEFAULT_SERVER;
      chrome.runtime.sendMessage(
        { type: 'start', config: { serverUrl, roomCode: newCode, swapHands } },
        () => {
          active = true;
          updateUI(true, false);
          setTimeout(refreshStatus, 1500);
        },
      );
    });
  }
});

// ── Copy room code to clipboard ───────────────────────────────────────────────
roomCodeEl.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentRoomCode);
    const original = roomCodeEl.textContent;
    roomCodeEl.textContent = '✓ Copied!';
    setTimeout(() => {
      roomCodeEl.textContent = original;
    }, 1000);
  } catch (err) {
    console.warn('[popup] clipboard write failed:', err);
  }
});

// ── Settings toggle ───────────────────────────────────────────────────────────
settingsToggle.addEventListener('click', () => {
  settingsContent.classList.toggle('visible');
  const isVisible = settingsContent.classList.contains('visible');
  settingsToggle.textContent = isVisible ? '▼ Settings' : '▶ Settings';
});

// ── Save server URL changes ───────────────────────────────────────────────────
serverUrlEl.addEventListener('change', () => {
  const serverUrl = serverUrlEl.value.trim() || DEFAULT_SERVER;
  chrome.storage.local.get('config', (res) => {
    const config = res.config || {};
    config.serverUrl = serverUrl;
    chrome.storage.local.set({ config });
    updateRoomDisplay(currentRoomCode); // Update QR code with new server
  });
});

// ── Swap hands checkbox ────────────────────────────────────────────────────────
swapHandsEl.addEventListener('change', () => {
  swapHands = swapHandsEl.checked;
  updateGestureLabels();
  
  chrome.storage.local.get('config', (res) => {
    const config = res.config || {};
    config.swapHands = swapHands;
    chrome.storage.local.set({ config });
  });
  
  // If already active, send update to background
  if (active) {
    chrome.runtime.sendMessage({
      type: 'update-swap-hands',
      swapHands: swapHands
    });
  }
});

// ── Listen for status updates from background ─────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status-update') {
    active = msg.active;
    updateUI(msg.active, msg.readerConnected);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
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

function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'get-status' }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp) updateUI(resp.active, resp.readerConnected);
  });
}
