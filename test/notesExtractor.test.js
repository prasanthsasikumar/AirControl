const { test } = require('node:test');
const assert = require('node:assert');
const { hasChanged, readSlideState } = require('../chrome-extension/notesExtractor.js');

function makeFakeDoc({ positionEl }) {
  return {
    querySelector(sel) {
      if (sel.includes('speakernotes')) return { innerText: 'my notes' };
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

test('readSlideState parses "N of M" text into 0-based index and total', () => {
  const fakeDoc = makeFakeDoc({ positionEl: { getAttribute: () => null, textContent: '3 of 12' } });
  assert.deepStrictEqual(readSlideState(fakeDoc), { index: 2, total: 12, notes: 'my notes' });
});
