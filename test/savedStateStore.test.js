import test from 'node:test';
import assert from 'node:assert/strict';

import {
  albumStorageKey,
  createSavedStateStore,
  normalizeAlbumRecord,
  summarizeAlbumRecord,
} from '../src/savedState/savedStateStore.js';

/** An in-memory stand-in for `chrome.storage.local`. */
function fakeStorageArea(initial = {}) {
  /** @type {Record<string, unknown>} */
  const data = { ...initial };
  return {
    /** @param {string | null} key */
    async get(key) {
      if (key === null) return { ...data };
      return key in data ? { [key]: data[key] } : {};
    },
    /** @param {Record<string, unknown>} entries */
    async set(entries) {
      Object.assign(data, entries);
    },
    /** @param {string | string[]} keys */
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
    data,
  };
}

test('rejects stored values that are not shaped like a record', () => {
  assert.deepEqual(normalizeAlbumRecord('A', null), { albumKey: 'A', updatedAt: 0, photos: {} });
  assert.deepEqual(normalizeAlbumRecord('A', 'garbage'), { albumKey: 'A', updatedAt: 0, photos: {} });
});

test('drops photo entries whose state is not one we wrote', () => {
  const record = normalizeAlbumRecord('A', {
    updatedAt: 5,
    photos: {
      good: { state: 'saved', checkedAt: 1 },
      wrongState: { state: 'maybe', checkedAt: 1 },
      notAnObject: 7,
    },
  });
  assert.deepEqual(Object.keys(record.photos), ['good']);
  assert.equal(record.updatedAt, 5);
});

test('counts saved and unsaved photos', () => {
  const summary = summarizeAlbumRecord({
    albumKey: 'A',
    updatedAt: 0,
    photos: {
      one: { state: 'saved', checkedAt: 0 },
      two: { state: 'unsaved', checkedAt: 0 },
      three: { state: 'unsaved', checkedAt: 0 },
    },
  });
  assert.deepEqual(summary, { known: 3, saved: 1, unsaved: 2 });
});

test('merging keeps earlier readings and overwrites the repeated ones', async () => {
  const storage = fakeStorageArea();
  const store = createSavedStateStore(/** @type {any} */ (storage));

  await store.mergePhotoStates('A', new Map([['p1', 'unsaved']]), 100);
  const record = await store.mergePhotoStates(
    'A',
    new Map([
      ['p1', 'saved'],
      ['p2', 'unsaved'],
    ]),
    200,
  );

  assert.equal(record.photos.p1?.state, 'saved');
  assert.equal(record.photos.p2?.state, 'unsaved');
  assert.equal(record.updatedAt, 200);
});

test('each album is stored under its own key', async () => {
  const storage = fakeStorageArea();
  const store = createSavedStateStore(/** @type {any} */ (storage));

  await store.mergePhotoStates('A', new Map([['p1', 'saved']]), 1);
  await store.mergePhotoStates('B', new Map([['p2', 'saved']]), 1);

  assert.ok(albumStorageKey('A') in storage.data);
  assert.ok(albumStorageKey('B') in storage.data);
});

test('clearing all albums leaves other stored values alone', async () => {
  const storage = fakeStorageArea({ 'settings:v1': { instantSwapEnabled: true } });
  const store = createSavedStateStore(/** @type {any} */ (storage));

  await store.mergePhotoStates('A', new Map([['p1', 'saved']]), 1);
  await store.mergePhotoStates('B', new Map([['p2', 'saved']]), 1);
  const removed = await store.clearAllAlbums();

  assert.equal(removed, 2);
  assert.deepEqual(Object.keys(storage.data), ['settings:v1']);
});
