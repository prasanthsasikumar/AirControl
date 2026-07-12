const { test } = require('node:test');
const assert = require('node:assert');
const { keyToIntent } = require('../public/glasses/js/intentMap.js');

test('Enter and ArrowRight map to next', () => {
  assert.strictEqual(keyToIntent('Enter'), 'next');
  assert.strictEqual(keyToIntent('ArrowRight'), 'next');
});

test('ArrowLeft maps to prev', () => {
  assert.strictEqual(keyToIntent('ArrowLeft'), 'prev');
});

test('ArrowUp/ArrowDown map to scroll', () => {
  assert.strictEqual(keyToIntent('ArrowUp'), 'scroll-up');
  assert.strictEqual(keyToIntent('ArrowDown'), 'scroll-down');
});

test('unknown keys map to null', () => {
  assert.strictEqual(keyToIntent('a'), null);
  assert.strictEqual(keyToIntent(''), null);
  assert.strictEqual(keyToIntent(undefined), null);
});
