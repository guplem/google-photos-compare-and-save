/**
 * Remembers, per album, which photos are already in your own library.
 *
 * One storage key per album keeps each write small, so a scan of a big album
 * never rewrites the data of every other album.
 */

export const SAVED_STATE_KEY_PREFIX = 'savedState:v1:';

/**
 * @typedef {'saved' | 'unsaved'} SavedState
 *
 * @typedef {object} PhotoSavedStateEntry
 * @property {SavedState} state
 * @property {number} checkedAt  Milliseconds since the epoch.
 *
 * @typedef {object} AlbumSavedStateRecord
 * @property {string} albumKey
 * @property {number} updatedAt
 * @property {Record<string, PhotoSavedStateEntry>} photos
 *
 * @typedef {object} AlbumSavedStateSummary
 * @property {number} known
 * @property {number} saved
 * @property {number} unsaved
 */

/**
 * @param {string} albumKey
 * @returns {string}
 */
export function albumStorageKey(albumKey) {
  return SAVED_STATE_KEY_PREFIX + albumKey;
}

/**
 * @param {string} albumKey
 * @returns {AlbumSavedStateRecord}
 */
export function createEmptyAlbumRecord(albumKey) {
  return { albumKey, updatedAt: 0, photos: {} };
}

/**
 * Rejects anything that does not look like a record we wrote.
 * @param {string} albumKey
 * @param {unknown} stored
 * @returns {AlbumSavedStateRecord}
 */
export function normalizeAlbumRecord(albumKey, stored) {
  if (stored === null || typeof stored !== 'object') return createEmptyAlbumRecord(albumKey);
  const raw = /** @type {Record<string, unknown>} */ (stored);
  const photos = raw.photos !== null && typeof raw.photos === 'object' ? /** @type {Record<string, unknown>} */ (raw.photos) : {};

  /** @type {Record<string, PhotoSavedStateEntry>} */
  const clean = {};
  for (const [photoKey, entry] of Object.entries(photos)) {
    if (entry === null || typeof entry !== 'object') continue;
    const candidate = /** @type {Record<string, unknown>} */ (entry);
    if (candidate.state !== 'saved' && candidate.state !== 'unsaved') continue;
    clean[photoKey] = {
      state: candidate.state,
      checkedAt: typeof candidate.checkedAt === 'number' ? candidate.checkedAt : 0,
    };
  }

  return {
    albumKey,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    photos: clean,
  };
}

/**
 * @param {AlbumSavedStateRecord} record
 * @returns {AlbumSavedStateSummary}
 */
export function summarizeAlbumRecord(record) {
  const entries = Object.values(record.photos);
  const saved = entries.filter((entry) => entry.state === 'saved').length;
  return { known: entries.length, saved, unsaved: entries.length - saved };
}

/**
 * @param {chrome.storage.StorageArea} storageArea
 */
export function createSavedStateStore(storageArea) {
  return {
    /**
     * @param {string} albumKey
     * @returns {Promise<AlbumSavedStateRecord>}
     */
    async readAlbum(albumKey) {
      const key = albumStorageKey(albumKey);
      const stored = await storageArea.get(key);
      return normalizeAlbumRecord(albumKey, stored[key]);
    },

    /**
     * Merges new readings into what is already stored.
     * @param {string} albumKey
     * @param {ReadonlyMap<string, SavedState>} states
     * @param {number} checkedAt
     * @returns {Promise<AlbumSavedStateRecord>}
     */
    async mergePhotoStates(albumKey, states, checkedAt = Date.now()) {
      const record = await this.readAlbum(albumKey);
      for (const [photoKey, state] of states) {
        record.photos[photoKey] = { state, checkedAt };
      }
      record.updatedAt = checkedAt;
      await storageArea.set({ [albumStorageKey(albumKey)]: record });
      return record;
    },

    /**
     * @param {string} albumKey
     * @returns {Promise<void>}
     */
    async clearAlbum(albumKey) {
      await storageArea.remove(albumStorageKey(albumKey));
    },

    /**
     * Removes the cached state of every album, but keeps the settings.
     * @returns {Promise<number>} How many albums were removed.
     */
    async clearAllAlbums() {
      const everything = await storageArea.get(null);
      const keys = Object.keys(everything).filter((key) => key.startsWith(SAVED_STATE_KEY_PREFIX));
      if (keys.length > 0) await storageArea.remove(keys);
      return keys.length;
    },
  };
}

/** @typedef {ReturnType<typeof createSavedStateStore>} SavedStateStore */
