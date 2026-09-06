import test from 'node:test';
import assert from 'node:assert/strict';

import { scanAlbumSavedState } from '../src/savedState/albumSavedStateScanner.js';

/**
 * A fake Google Photos viewer with a virtual clock, so the tests finish at once
 * instead of really waiting for the scan delays.
 *
 * @param {object} options
 * @param {Array<'saved' | 'unsaved'>} options.states  One entry per photo, in album order.
 * @param {number} [options.blankReadings]             Readings that return null on arrival, per photo.
 * @param {number} [options.lateSaveButtonReadings]    Readings that look "saved" before the Save button draws.
 * @param {number} [options.workingAdvanceAttempt]     Which "next photo" method actually works.
 * @param {boolean} [options.wrapsAround]              Whether the last photo leads back to the first.
 * @param {Record<string, 'saved' | 'unsaved'>} [options.cache]
 */
function fakeViewer({
  states,
  blankReadings = 0,
  lateSaveButtonReadings = 0,
  workingAdvanceAttempt = 0,
  wrapsAround = false,
  cache = {},
}) {
  const photoKeys = states.map((_state, index) => `photo-${index}`);
  let index = 0;
  let clock = 0;
  let readingsSinceArrival = 0;
  let probeCalls = 0;

  /** @type {Array<[string, 'saved' | 'unsaved']>} */
  const results = [];

  return {
    results,
    get probeCalls() {
      return probeCalls;
    },
    deps: {
      readCurrentPhotoKey: () => photoKeys[index] ?? null,
      /** @param {number} attempt */
      async requestNextPhoto(attempt) {
        if (attempt !== workingAdvanceAttempt) return;
        if (index < photoKeys.length - 1) index += 1;
        else if (wrapsAround) index = 0;
        else index = photoKeys.length; // past the end: readCurrentPhotoKey returns null
        readingsSinceArrival = 0;
      },
      probe: () => {
        probeCalls += 1;
        readingsSinceArrival += 1;
        if (readingsSinceArrival <= blankReadings) return null;
        // The toolbar is drawn but the Save button has not appeared yet, so the
        // photo looks saved even though it is not.
        if (readingsSinceArrival <= blankReadings + lateSaveButtonReadings) return 'saved';
        return states[index] ?? null;
      },
      /** @param {number} milliseconds */
      async wait(milliseconds) {
        clock += milliseconds;
      },
      now: () => clock,
      /** @param {string} photoKey */
      readCachedState: (photoKey) => cache[photoKey] ?? null,
      /**
       * @param {string} photoKey
       * @param {'saved' | 'unsaved'} state
       */
      onResult: (photoKey, state) => results.push([photoKey, state]),
      onProgress: () => {},
      shouldStop: () => false,
      pollMs: 10,
      minDwellMs: 0,
      confirmSavedMs: 20,
      timeoutMs: 500,
      rescanKnown: false,
    },
  };
}

test('reads every photo of the album and counts them', async () => {
  const viewer = fakeViewer({ states: ['saved', 'unsaved', 'unsaved'] });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.reason, 'end-of-album');
  assert.deepEqual(
    { scanned: outcome.scanned, saved: outcome.saved, unsaved: outcome.unsaved },
    { scanned: 3, saved: 1, unsaved: 2 },
  );
  assert.deepEqual(viewer.results, [
    ['photo-0', 'saved'],
    ['photo-1', 'unsaved'],
    ['photo-2', 'unsaved'],
  ]);
});

test('waits for the toolbar instead of trusting the first reading', async () => {
  const viewer = fakeViewer({ states: ['unsaved', 'unsaved'], blankReadings: 2 });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.unsaved, 2);
  assert.equal(outcome.unknown, 0);
});

test('a Save button that draws late is still seen, never reported as saved', async () => {
  // This is the failure that loses photos: the toolbar is up, the Save button is
  // not drawn yet, so the photo looks saved. `confirmSavedMs` must outlast that.
  const viewer = fakeViewer({ states: ['unsaved'], lateSaveButtonReadings: 1 });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.unsaved, 1);
  assert.equal(outcome.saved, 0);
  assert.deepEqual(viewer.results, [['photo-0', 'unsaved']]);
});

test('accepts an unsaved reading at once, because a Save button cannot appear by accident', async () => {
  const viewer = fakeViewer({ states: ['unsaved'] });

  await scanAlbumSavedState(viewer.deps);

  // One poll for the answer, then the attempts to move past the end.
  assert.equal(viewer.probeCalls, 1);
});

test('reports a photo as unknown when the toolbar never appears', async () => {
  const viewer = fakeViewer({ states: ['unsaved'], blankReadings: Number.MAX_SAFE_INTEGER });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.deepEqual(
    { unknown: outcome.unknown, saved: outcome.saved, unsaved: outcome.unsaved },
    { unknown: 1, saved: 0, unsaved: 0 },
  );
  assert.deepEqual(viewer.results, [], 'a photo we could not read must not be written to the cache');
});

test('skips the toolbar entirely for photos already in the cache', async () => {
  const viewer = fakeViewer({
    states: ['saved', 'unsaved'],
    cache: { 'photo-0': 'saved', 'photo-1': 'unsaved' },
  });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.scanned, 2);
  assert.equal(viewer.probeCalls, 0);
});

test('rescanKnown reads the toolbar again even for cached photos', async () => {
  const viewer = fakeViewer({ states: ['saved'], cache: { 'photo-0': 'saved' } });
  viewer.deps.rescanKnown = true;

  await scanAlbumSavedState(viewer.deps);

  assert.ok(viewer.probeCalls > 0);
});

test('falls back to the named next-photo button when the arrow key does nothing', async () => {
  const viewer = fakeViewer({ states: ['saved', 'unsaved'], workingAdvanceAttempt: 2 });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.scanned, 2);
  assert.equal(outcome.reason, 'end-of-album');
});

test('reports "stuck" when no way of moving to the next photo works', async () => {
  const viewer = fakeViewer({ states: ['saved', 'unsaved'], workingAdvanceAttempt: 99 });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.reason, 'stuck');
  assert.equal(outcome.scanned, 1);
});

test('stops on request, after finishing the photo in hand', async () => {
  const viewer = fakeViewer({ states: ['saved', 'unsaved', 'unsaved'] });
  let seen = 0;
  viewer.deps.onProgress = () => {
    seen += 1;
  };
  viewer.deps.shouldStop = () => seen >= 2;

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.reason, 'stopped');
  assert.equal(outcome.scanned, 2);
});

test('detects an album that loops back to its first photo', async () => {
  const viewer = fakeViewer({ states: ['saved', 'unsaved'], wrapsAround: true });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.reason, 'loop-detected');
  assert.equal(outcome.scanned, 2);
});

test('does nothing when the viewer is not open', async () => {
  const viewer = fakeViewer({ states: [] });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.reason, 'no-photo-open');
});
