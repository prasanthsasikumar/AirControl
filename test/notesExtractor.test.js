const { test } = require('node:test');
const assert = require('node:assert');
const { hasChanged, readSlideState } = require('../chrome-extension/notesExtractor.js');

function makeFakeDoc({ positionEl }) {
  return {
    querySelector(sel) {
      // SEL_NOTES targets the notes body; SEL_POSITION targets the "Slide N of M" header.
      if (sel.includes('text-body')) return { innerText: 'my notes' };
      return positionEl;
    },
  };
}

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

test('readSlideState returns null index/total when the position element is absent', () => {
  const fakeDoc = makeFakeDoc({ positionEl: null });
  assert.deepStrictEqual(readSlideState(fakeDoc), { index: null, total: null, notes: 'my notes' });
});

test('readSlideState parses "Slide N of M" header into 0-based index and total', () => {
  const fakeDoc = makeFakeDoc({ positionEl: { getAttribute: () => null, textContent: 'Slide 8 of 57' } });
  assert.deepStrictEqual(readSlideState(fakeDoc), { index: 7, total: 57, notes: 'my notes' });
});
