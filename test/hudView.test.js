const { test } = require('node:test');
const assert = require('node:assert');
const { formatHud } = require('../public/glasses/js/hudView.js');

test('formats slide label as 1-based index / total', () => {
  const out = formatHud({ index: 0, total: 12, notes: 'x', startedAt: 0 }, 0);
  assert.strictEqual(out.slideLabel, '1 / 12');
});

test('formats elapsed timer as mm:ss from startedAt to now', () => {
  const out = formatHud({ index: 0, total: 1, notes: '', startedAt: 1000 }, 1000 + 65_000);
  assert.strictEqual(out.timerLabel, '01:05');
});

test('clamps negative elapsed to 00:00', () => {
  const out = formatHud({ index: 0, total: 1, notes: '', startedAt: 5000 }, 1000);
  assert.strictEqual(out.timerLabel, '00:00');
});

test('passes notes through, defaulting empty to a placeholder', () => {
  assert.strictEqual(formatHud({ index: 0, total: 1, notes: 'hi', startedAt: 0 }, 0).notes, 'hi');
  assert.strictEqual(formatHud({ index: 0, total: 1, notes: '', startedAt: 0 }, 0).notes, '(no notes for this slide)');
});
