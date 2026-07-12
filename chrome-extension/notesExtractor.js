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
