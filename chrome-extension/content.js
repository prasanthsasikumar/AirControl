/**
 * content.js — AirControl Chrome Extension content script
 *
 * Injected into Google Slides / PowerPoint Online / Canva pages.
 * Receives gesture commands from the background service worker and
 * dispatches the appropriate keyboard events to control slides.
 *
 * Also renders a small overlay indicator showing gesture state.
 */

(() => {
  // ── Detect which presentation platform we're on ─────────────────────────
  const host = location.hostname;
  let platform = 'unknown';
  if (host.includes('docs.google.com'))        platform = 'google-slides';
  else if (host.includes('officeapps.live.com')) platform = 'powerpoint';
  else if (host.includes('canva.com'))           platform = 'canva';

  console.log(`[AirControl] content script loaded on ${platform}`);

  // ── Overlay indicator ───────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'aircontrol-overlay';
  overlay.innerHTML = `
    <div class="sg-icon">✋</div>
    <div class="sg-label">AirControl</div>
  `;
  const style = document.createElement('style');
  style.textContent = `
    #aircontrol-overlay {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      background: rgba(0, 0, 0, 0.75);
      color: #fff;
      padding: 8px 14px;
      border-radius: 12px;
      font-family: system-ui, sans-serif;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: none;
      opacity: 0.5;
      transition: opacity 0.3s, background 0.3s, transform 0.15s;
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255,255,255,0.1);
    }
    #aircontrol-overlay.sg-pinching {
      opacity: 0.9;
      background: rgba(0, 100, 200, 0.8);
      border-color: rgba(0, 200, 255, 0.5);
    }
    #aircontrol-overlay.sg-action-next {
      opacity: 1;
      background: rgba(0, 180, 80, 0.85);
      transform: translateX(-8px);
    }
    #aircontrol-overlay.sg-action-prev {
      opacity: 1;
      background: rgba(200, 120, 0, 0.85);
      transform: translateX(8px);
    }
    #aircontrol-overlay .sg-icon {
      font-size: 18px;
      line-height: 1;
    }
    #aircontrol-overlay .sg-label {
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(overlay);

  const iconEl  = overlay.querySelector('.sg-icon');
  const labelEl = overlay.querySelector('.sg-label');

  // ── Keyboard dispatch ───────────────────────────────────────────────────
  function dispatchKey(key) {
    console.log(`[AirControl] dispatching ${key}`);

    const keyCode = key === 'ArrowRight' ? 39 : key === 'ArrowLeft' ? 37 : 0;
    
    const opts = {
      key,
      code: key,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
    };

    // Strategy: Try the most specific target first, stop on success
    
    // 1. Google Slides presentation mode (fullscreen)
    const presentIframe = document.querySelector('iframe.punch-present-iframe');
    if (presentIframe) {
      try {
        if (presentIframe.contentDocument) {
          console.log('[AirControl] → dispatching to presentation iframe');
          presentIframe.contentDocument.dispatchEvent(new KeyboardEvent('keydown', opts));
          presentIframe.contentDocument.dispatchEvent(new KeyboardEvent('keyup', opts));
          return;
        }
      } catch (e) {
        console.warn('[AirControl] iframe access denied:', e);
      }
    }

    // 2. Google Slides viewer content (edit mode)
    const viewer = document.querySelector('.punch-viewer-content');
    if (viewer) {
      console.log('[AirControl] → dispatching to viewer content');
      viewer.dispatchEvent(new KeyboardEvent('keydown', opts));
      viewer.dispatchEvent(new KeyboardEvent('keyup', opts));
      return;
    }

    // 3. Application role element (Google Slides)
    const app = document.querySelector('[role="application"]');
    if (app) {
      console.log('[AirControl] → dispatching to application element');
      app.dispatchEvent(new KeyboardEvent('keydown', opts));
      app.dispatchEvent(new KeyboardEvent('keyup', opts));
      return;
    }

    // 4. Document body (general fallback)
    console.log('[AirControl] → dispatching to document body');
    document.body.focus();
    document.body.dispatchEvent(new KeyboardEvent('keydown', opts));
    document.body.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function nextSlide() {
    console.log('[AirControl] → Next slide');
    dispatchKey('ArrowRight');
    flashOverlay('next');
  }

  function prevSlide() {
    console.log('[AirControl] ← Previous slide');
    dispatchKey('ArrowLeft');
    flashOverlay('prev');
  }

  // ── Visual feedback ─────────────────────────────────────────────────────
  let flashTimeout = null;

  function flashOverlay(action) {
    clearTimeout(flashTimeout);
    overlay.className = '';

    if (action === 'next') {
      overlay.classList.add('sg-action-next');
      iconEl.textContent = '→';
      labelEl.textContent = 'Next slide';
    } else if (action === 'prev') {
      overlay.classList.add('sg-action-prev');
      iconEl.textContent = '←';
      labelEl.textContent = 'Previous slide';
    }

    flashTimeout = setTimeout(() => {
      overlay.className = '';
      iconEl.textContent = '✋';
      labelEl.textContent = 'AirControl';
    }, 800);
  }

  // ── Listen for messages from background.js ──────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'slide-action') {
      if (msg.action === 'next') nextSlide();
      else if (msg.action === 'prev') prevSlide();
    }

    if (msg.type === 'gesture-state') {
      if (msg.pinching && !msg.action) {
        overlay.classList.add('sg-pinching');
        const hand = msg.handedness === 'Left' ? '👈' : '👉';
        iconEl.textContent = hand;
        labelEl.textContent = `${msg.handedness} hand`;
      } else if (!msg.pinching && !msg.action) {
        overlay.classList.remove('sg-pinching');
        iconEl.textContent = '✋';
        labelEl.textContent = 'AirControl';
      }
    }
  });

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
})();
