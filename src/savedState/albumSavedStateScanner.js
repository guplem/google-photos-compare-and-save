/**
 * Walks an album one photo at a time and records, for each photo, whether it is
 * already in your library.
 *
 * Why walk the album instead of asking an API: the public Google Photos API was
 * restricted in 2025 and can no longer list your library, and the site's own
 * internal endpoints return unnamed nested arrays that change without notice.
 * The viewer toolbar is the same signal a person uses, so it is the one signal
 * that stays readable.
 *
 * This file holds no DOM code. Every browser action arrives as a function, which
 * keeps the walk testable and keeps the fragile selectors in one other place.
 *
 * ## How long each photo takes
 *
 * The two answers are not symmetrical, and the timing exploits that.
 *
 * A visible "Save" button is positive evidence. A half-drawn toolbar cannot
 * invent one, so we accept `unsaved` on the first clear reading.
 *
 * `saved` is the *absence* of that button, which is exactly what a toolbar that
 * has not finished drawing looks like. So `saved` must hold for `confirmSavedMs`
 * before we believe it.
 *
 * Both answers ignore the first `minDwellMs` after arriving, because the toolbar
 * still shows the previous photo for a moment.
 */

/**
 * @typedef {import('./savedStateStore.js').SavedState} SavedState
 *
 * @typedef {object} ScanProgress
 * @property {number} scanned   Photos visited so far.
 * @property {number} saved
 * @property {number} unsaved
 * @property {number} unknown   Photos whose toolbar never settled.
 * @property {string} photoKey  The photo just visited.
 *
 * @typedef {'end-of-album' | 'stopped' | 'loop-detected' | 'no-photo-open' | 'stuck'} ScanStopReason
 *
 * @typedef {object} ScanOutcome
 * @property {ScanStopReason} reason
 * @property {number} scanned
 * @property {number} saved
 * @property {number} unsaved
 * @property {number} unknown
 *
 * @typedef {object} AlbumScannerDeps
 * @property {() => string | null} readCurrentPhotoKey  Photo id currently in the address bar.
 * @property {() => 'enabled' | 'disabled' | 'missing'} readNextControlState  The state of the next-photo control.
 * @property {(attempt: number) => Promise<void>} requestNextPhoto  Ask the page to move on; attempt 0, then 1, then 2.
 * @property {() => SavedState | null} probe  Read the toolbar; null means "cannot tell yet".
 * @property {(milliseconds: number) => Promise<void>} wait
 * @property {() => number} now
 * @property {(photoKey: string) => SavedState | null} readCachedState
 * @property {(photoKey: string, state: SavedState) => void} onResult
 * @property {(progress: ScanProgress) => void} onProgress
 * @property {() => boolean} shouldStop
 * @property {number} pollMs          How often to read the toolbar.
 * @property {number} minDwellMs      Ignore readings taken this soon after arriving.
 * @property {number} confirmSavedMs  How long "no Save button" must hold before we believe it.
 * @property {number} timeoutMs       Give up on one photo after this long.
 * @property {boolean} rescanKnown
 */

/** How many different ways we try to move to the next photo before giving up. */
const ADVANCE_ATTEMPTS = 3;

/**
 * How long we wait for the address bar to show the next photo, per attempt.
 * The address bar updates as soon as the app accepts the key, well before the
 * photo finishes loading, so this does not need to be generous.
 */
const ADVANCE_TIMEOUT_MS = 1200;

/** How often we look at the address bar while waiting, in milliseconds. */
const ADVANCE_POLL_MS = 40;

/**
 * @param {AlbumScannerDeps} deps
 * @returns {Promise<ScanOutcome>}
 */
export async function scanAlbumSavedState(deps) {
  const { readCurrentPhotoKey, requestNextPhoto, probe, wait, now, readCachedState, onResult, onProgress, shouldStop } = deps;

  /** @type {Set<string>} */
  const visited = new Set();
  let saved = 0;
  let unsaved = 0;
  let unknown = 0;

  /**
   * Reads the toolbar until the answer is trustworthy. See the note at the top
   * of this file for why the two answers are treated differently.
   * @returns {Promise<SavedState | null>}
   */
  async function readSettledState() {
    const arrivedAt = now();
    const deadline = arrivedAt + deps.timeoutMs;

    /** @type {SavedState | null} */
    let previous = null;
    /** @type {number | null} */
    let savedSince = null;

    while (now() < deadline) {
      await wait(deps.pollMs);
      const current = probe();

      if (now() - arrivedAt < deps.minDwellMs) {
        previous = current;
        continue;
      }

      if (current === null) {
        previous = null;
        savedSince = null;
        continue;
      }

      if (current === 'unsaved') return 'unsaved';

      if (previous !== 'saved') savedSince = now();
      if (savedSince !== null && now() - savedSince >= deps.confirmSavedMs) return 'saved';
      previous = 'saved';
    }

    return null;
  }

  /**
   * Moves to the next photo, trying each available method in turn.
   * @param {string} currentPhotoKey
   * @returns {Promise<string | null>} The new photo id, or null when nothing worked.
   */
  async function advancePastPhoto(currentPhotoKey) {
    for (let attempt = 0; attempt < ADVANCE_ATTEMPTS; attempt += 1) {
      await requestNextPhoto(attempt);

      const deadline = now() + ADVANCE_TIMEOUT_MS;
      while (now() < deadline) {
        await wait(ADVANCE_POLL_MS);
        const key = readCurrentPhotoKey();
        if (key === null) return null;
        if (key !== currentPhotoKey) return key;
      }
    }
    return null;
  }

  /**
   * @param {ScanStopReason} reason
   * @returns {ScanOutcome}
   */
  const outcome = (reason) => ({ reason, scanned: visited.size, saved, unsaved, unknown });

  let photoKey = readCurrentPhotoKey();
  if (photoKey === null) return outcome('no-photo-open');

  for (;;) {
    if (visited.has(photoKey)) return outcome('loop-detected');
    visited.add(photoKey);

    const cached = readCachedState(photoKey);
    const state = !deps.rescanKnown && cached !== null ? cached : await readSettledState();

    if (state === null) {
      unknown += 1;
    } else {
      if (state === 'saved') saved += 1;
      else unsaved += 1;
      onResult(photoKey, state);
    }

    onProgress({ scanned: visited.size, saved, unsaved, unknown, photoKey });

    if (shouldStop()) return outcome('stopped');

    const nextPhotoKey = await advancePastPhoto(photoKey);
    if (nextPhotoKey === null) {
      // The viewer closed, so there is nothing left to read.
      if (readCurrentPhotoKey() === null) return outcome('end-of-album');

      // The viewer is still open on the same photo. Google Photos does exactly
      // that on the last photo of an album, so "cannot advance" is not proof of
      // a stall. Only a next control that is present and disabled proves the
      // album ended. Anything else stays `stuck`, because a scan that claims to
      // be complete without that proof leaves the user trusting badges for
      // photos it never read.
      return outcome(deps.readNextControlState() === 'disabled' ? 'end-of-album' : 'stuck');
    }
    photoKey = nextPhotoKey;
  }
}
