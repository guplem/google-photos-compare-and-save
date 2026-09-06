import test from 'node:test';
import assert from 'node:assert/strict';

import { MIN_PHOTO_INTERVAL_MS, scanAlbumSavedState } from '../src/savedState/albumSavedStateScanner.js';

/**
 * A fake Google Photos viewer with a virtual clock, so the tests finish at once
 * instead of really waiting for the scan delays.
 *
 * @param {object} options
 * @param {Array<'saved' | 'unsaved'>} options.states  One entry per photo, in album order.
 * @param {number} [options.blankReadings]             Readings that return null on arrival, per photo.
 * @param {number} [options.lateSaveButtonReadings]    Readings that look "saved" before the Save button draws.
 * @param {number} [options.workingAdvanceAttempt]     Which "next photo" method actually works.
 * @param {number} [options.advanceDelayMs]            How long the page takes to show the next photo.
 * @param {boolean} [options.chromeHidesWhenIdle]      Whether the toolbar disappears unless the page is woken.
 * @param {boolean} [options.wrapsAround]              Whether the last photo leads back to the first.
 * @param {'closes' | 'stays'} [options.endBehavior]   What the viewer does past the last photo. Google Photos stays.
 * @param {'enabled' | 'disabled' | 'missing'} [options.nextControlState] The state of the next-photo control.
 * @param {Record<string, 'saved' | 'unsaved'>} [options.cache]
 */
function fakeViewer({
  states,
  blankReadings = 0,
  lateSaveButtonReadings = 0,
  workingAdvanceAttempt = 0,
  advanceDelayMs = 0,
  chromeHidesWhenIdle = false,
  wrapsAround = false,
  endBehavior = 'closes',
  nextControlState = 'enabled',
  cache = {},
}) {
  const photoKeys = states.map((_state, index) => `photo-${index}`);
  let index = 0;
  let clock = 0;
  /** When the page will finally reveal the photo it was asked for. */
  let advanceReadyAt = 0;
  let pendingIndex = -1;
  /** Google Photos shows the toolbar for a moment after the pointer moves. */
  let awakeUntil = 0;
  let readingsSinceArrival = 0;
  let probeCalls = 0;

  /** @type {Array<[string, 'saved' | 'unsaved']>} */
  const results = [];

  return {
    results,
    get probeCalls() {
      return probeCalls;
    },
    get elapsed() {
      return clock;
    },
    deps: {
      readCurrentPhotoKey: () => {
        // The page needs advanceDelayMs to catch up before it shows the photo.
        if (pendingIndex >= 0 && clock >= advanceReadyAt) {
          index = pendingIndex;
          pendingIndex = -1;
        }
        return photoKeys[index] ?? null;
      },
      readNextControlState: () => nextControlState,
      /** @param {number} attempt */
      async requestNextPhoto(attempt) {
        if (attempt !== workingAdvanceAttempt) return;
        let target;
        if (index < photoKeys.length - 1) target = index + 1;
        else if (wrapsAround) target = 0;
        // Past the last photo, a real Google Photos viewer stays open on it.
        else if (endBehavior === 'stays') return;
        else target = photoKeys.length; // readCurrentPhotoKey then returns null
        pendingIndex = target;
        advanceReadyAt = clock + advanceDelayMs;
        readingsSinceArrival = 0;
      },
      keepPageAwake: () => {
        awakeUntil = clock + 1000;
      },
      probe: () => {
        probeCalls += 1;
        readingsSinceArrival += 1;
        // A hidden toolbar has no buttons at all, which the probe reports as null.
        if (chromeHidesWhenIdle && clock > awakeUntil) return null;
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

test('does not make a visible Save button wait out the settling delay', async () => {
  // The speed win: in a shared album almost every photo is unsaved, so this is
  // the path that decides how long a whole scan takes.
  const viewer = fakeViewer({ states: ['unsaved'] });
  viewer.deps.minDwellMs = 500;

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.unsaved, 1);
  assert.ok(viewer.elapsed < 500, `reading it took ${viewer.elapsed}ms, so the delay was still paid`);
});

test('still makes an absent Save button wait, because absence can mean "not drawn yet"', async () => {
  const viewer = fakeViewer({ states: ['saved'] });
  viewer.deps.minDwellMs = 200;

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.saved, 1);
  assert.ok(viewer.elapsed >= 200, `it believed "saved" after only ${viewer.elapsed}ms`);
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
  // Odd attempts click the control; even attempts send the key.
  const viewer = fakeViewer({ states: ['saved', 'unsaved'], workingAdvanceAttempt: 1 });

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

test('a disabled next control means the album ended, even though the viewer stayed open', async () => {
  // The real failure: Google Photos keeps the viewer open on the last photo, so
  // the photo id never becomes null and a finished scan looked like a stall.
  const viewer = fakeViewer({ states: ['saved', 'unsaved'], endBehavior: 'stays', nextControlState: 'disabled' });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.reason, 'end-of-album');
  assert.equal(outcome.scanned, 2);
});

test('an enabled next control that does nothing is a stall, not the end', async () => {
  const viewer = fakeViewer({ states: ['saved', 'unsaved'], endBehavior: 'stays', nextControlState: 'enabled' });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.reason, 'stuck');
});

test('keeps going when the page takes seconds to show the next photo', async () => {
  // The real failure: a scan that raced through cached photos outran the album
  // loading, then gave up after a budget far shorter than the page needed.
  const viewer = fakeViewer({ states: ['saved', 'unsaved', 'unsaved'], advanceDelayMs: 4000 });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.reason, 'end-of-album');
  assert.equal(outcome.scanned, 3);
});

test('paces itself through cached photos so it cannot outrun the page', async () => {
  /** @type {Record<string, 'saved' | 'unsaved'>} */
  const cache = { 'photo-0': 'saved', 'photo-1': 'saved', 'photo-2': 'saved' };
  const viewer = fakeViewer({ states: ['saved', 'saved', 'saved'], cache });

  await scanAlbumSavedState(viewer.deps);

  assert.equal(viewer.probeCalls, 0, 'cached photos must still skip the toolbar read');
  assert.ok(viewer.elapsed >= 2 * MIN_PHOTO_INTERVAL_MS, `a cached run must still pace each photo, spent ${viewer.elapsed}ms`);
});

test('wakes the page when the toolbar reads as empty, instead of losing the photo', async () => {
  // Google Photos hides the viewer chrome while the pointer stays still. A scan
  // never moves the pointer, so without a wake it reads an empty toolbar and
  // marks a readable photo unreadable.
  const viewer = fakeViewer({ states: ['unsaved', 'saved'], chromeHidesWhenIdle: true });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.unknown, 0, 'no photo should be lost to a hidden toolbar');
  assert.equal(outcome.unsaved, 1);
  assert.equal(outcome.saved, 1);
});

test('reports the state of the next control when it gives up, so a stall can be diagnosed', async () => {
  const viewer = fakeViewer({ states: ['unsaved'], endBehavior: 'stays', nextControlState: 'missing' });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.reason, 'stuck');
  assert.equal(outcome.nextControlState, 'missing');
});

test('a next control we cannot find is never treated as the end', async () => {
  // Claiming a complete scan without evidence is the worse error: the user
  // would trust badges for photos the scan never reached.
  const viewer = fakeViewer({ states: ['saved', 'unsaved'], endBehavior: 'stays', nextControlState: 'missing' });

  const outcome = await scanAlbumSavedState(viewer.deps);

  assert.equal(outcome.reason, 'stuck');
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
