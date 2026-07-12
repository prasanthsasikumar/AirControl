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
