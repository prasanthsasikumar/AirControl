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
