import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseScanStart, mergeOrderedPhotoKeys } from '../src/savedState/albumGridReader.js';

/**
 * @param {string[]} known
 * @returns {(photoKey: string) => boolean}
 */
const knows = (known) => (photoKey) => known.includes(photoKey);

test('keeps the order it first saw and drops the repeats', () => {
  // Scroll steps overlap, so the same thumbnail appears in several of them.
  const merged = mergeOrderedPhotoKeys(['a', 'b', 'c'], ['b', 'c', 'd', 'e']);

  assert.deepEqual(merged, ['a', 'b', 'c', 'd', 'e']);
});

test('starts at the first photo that has not been checked', () => {
  const plan = chooseScanStart(['a', 'b', 'c', 'd'], knows(['a', 'b']), false);

  assert.deepEqual(plan, { mode: 'start-at', photoKey: 'c' });
});

test('reads the whole album again once every photo is already checked', () => {
  // Reaching the bottom is what makes "all of them" trustworthy.
  const plan = chooseScanStart(['a', 'b'], knows(['a', 'b']), true);

  assert.deepEqual(plan, { mode: 'rescan-all', photoKey: 'a' });
});

test('starts at the last photo it saw when it ran out of scrolling', () => {
  // Everything seen so far is known, but the album has more below. Starting at
  // the last one seen beats starting at the first, which is the whole point.
  const plan = chooseScanStart(['a', 'b', 'c'], knows(['a', 'b', 'c']), false);

  assert.deepEqual(plan, { mode: 'start-at', photoKey: 'c' });
});

test('reports that the grid held no photos', () => {
  assert.deepEqual(chooseScanStart([], knows([]), true), { mode: 'no-photos' });
});

test('starts at the very first photo when nothing has been checked yet', () => {
  const plan = chooseScanStart(['a', 'b', 'c'], knows([]), false);

  assert.deepEqual(plan, { mode: 'start-at', photoKey: 'a' });
});
