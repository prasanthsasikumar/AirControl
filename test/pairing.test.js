const { test } = require('node:test');
const assert = require('node:assert');
const { applyKey } = require('../public/glasses/js/pairing.js');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

test('ArrowRight/ArrowLeft move the cursor between slots, with wrap', () => {
  assert.deepStrictEqual(
    applyKey({ code: 'AAAAAA', cursor: 0 }, 'ArrowRight', ALPHABET),
    { code: 'AAAAAA', cursor: 1, submit: false },
  );
  assert.deepStrictEqual(
    applyKey({ code: 'AAAAAA', cursor: 5 }, 'ArrowRight', ALPHABET),
    { code: 'AAAAAA', cursor: 0, submit: false }, // wraps past the end
  );
  assert.deepStrictEqual(
    applyKey({ code: 'AAAAAA', cursor: 0 }, 'ArrowLeft', ALPHABET),
    { code: 'AAAAAA', cursor: 5, submit: false }, // wraps before the start
  );
});

test('ArrowUp/ArrowDown cycle the highlighted character only', () => {
  // Up = forward through the alphabet at the cursor slot
  assert.deepStrictEqual(
    applyKey({ code: 'AAAAAA', cursor: 2 }, 'ArrowUp', ALPHABET),
    { code: 'AABAAA', cursor: 2, submit: false },
  );
  // Down = backward, wrapping A -> last char
  assert.deepStrictEqual(
    applyKey({ code: 'AAAAAA', cursor: 0 }, 'ArrowDown', ALPHABET),
    { code: '9AAAAA', cursor: 0, submit: false },
  );
});

test('Enter sets submit and leaves code/cursor unchanged', () => {
  assert.deepStrictEqual(
    applyKey({ code: 'ABC234', cursor: 3 }, 'Enter', ALPHABET),
    { code: 'ABC234', cursor: 3, submit: true },
  );
});

test('unknown keys are a no-op', () => {
  assert.deepStrictEqual(
    applyKey({ code: 'ABC234', cursor: 3 }, 'x', ALPHABET),
    { code: 'ABC234', cursor: 3, submit: false },
  );
});
