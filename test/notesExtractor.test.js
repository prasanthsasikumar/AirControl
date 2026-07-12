const { test } = require('node:test');
const assert = require('node:assert');
const { hasChanged } = require('../chrome-extension/notesExtractor.js');

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
