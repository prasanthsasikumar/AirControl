/**
 * pairing.js — pure reducer for the D-pad room-code editor.
 *
 * D-pad mapping (Neural Band arrives as arrow keys):
 *   • Left / Right  → move the cursor between character slots
 *   • Up / Down     → cycle the highlighted character (up = forward)
 *   • Enter (pinch) → submit
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pairing = api;
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * Apply one D-pad key to the pairing state.
   * @param {{code: string, cursor: number}} state
   * @param {string} key — a KeyboardEvent.key value
   * @param {string} alphabet — allowed characters, in cycle order
   * @returns {{code: string, cursor: number, submit: boolean}} next state
   */
  function applyKey(state, key, alphabet) {
    const len = state.code.length;
    let code = state.code;
    let cursor = state.cursor;
    let submit = false;

    switch (key) {
      case 'ArrowRight':
        cursor = (cursor + 1) % len;
        break;
      case 'ArrowLeft':
        cursor = (cursor - 1 + len) % len;
        break;
      case 'ArrowUp':
      case 'ArrowDown': {
        const delta = key === 'ArrowUp' ? 1 : -1;
        const i = alphabet.indexOf(code[cursor]);
        const base = i < 0 ? 0 : i;
        const next = (base + delta + alphabet.length) % alphabet.length;
        code = code.slice(0, cursor) + alphabet[next] + code.slice(cursor + 1);
        break;
      }
      case 'Enter':
        submit = true;
        break;
    }

    return { code, cursor, submit };
  }

  return { applyKey };
});
