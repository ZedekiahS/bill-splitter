import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindExpenseSearch } from '../public/scripts/expense-search.mjs';

function fixture(value = '') {
  const input = new EventTarget();
  input.value = value;
  const changes = [];
  bindExpenseSearch(input, value => changes.push(value));
  const send = (type, value, isComposing = false) => {
    input.value = value;
    const event = new Event(type);
    Object.defineProperty(event, 'isComposing', { value: isComposing });
    input.dispatchEvent(event);
  };
  return { input, changes, send };
}

test('Chinese composition filters only the completed phrase, including final input event', () => {
  const f = fixture();
  f.send('compositionstart', '');
  f.send('input', 'huo', true);
  f.send('input', '火', true);
  assert.deepEqual(f.changes, []);
  f.send('compositionend', '火锅');
  f.send('input', '火锅');
  assert.deepEqual(f.changes, ['火锅']);
  assert.equal(f.input.value, '火锅');
});

test('plain typing, pasting, and replacing a query update immediately', () => {
  const f = fixture('dinner');
  f.send('input', 'rent');
  f.send('input', '周末 火锅');
  assert.deepEqual(f.changes, ['rent', '周末 火锅']);
});

test('the native clear button restores all results without duplicate updates', () => {
  const f = fixture('火锅');
  f.send('input', '');
  f.send('search', '');
  assert.deepEqual(f.changes, ['']);
});

test('composition cancellation keeps the prior query and allows subsequent typing', () => {
  const f = fixture('住宿');
  f.send('compositionstart', '住宿');
  f.send('input', '住宿 fei', true);
  f.send('compositionend', '住宿');
  assert.deepEqual(f.changes, []);
  f.send('input', '住宿费');
  assert.deepEqual(f.changes, ['住宿费']);
});
