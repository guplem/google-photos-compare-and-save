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
 * invent one, so we accept `unsaved` on the first clear reading and skip the
 * dwell entirely. That is the fast path, and in a shared album worth managing it
 * is almost every photo.
 *
 * `saved` is the *absence* of that button, which is exactly what a toolbar that
 * has not finished drawing looks like. So `saved` waits out `minDwellMs` and
 * then must hold for `confirmSavedMs` before we believe it.
 *
 * `minDwellMs` covers the moment when the toolbar still belongs to the previous
 * photo. Only `saved` pays it, because a stale reading can only cost a photo in
 * that direction. A stale Save button badges a saved photo unsaved, and the user
 * loses nothing: Google Photos deduplicates a file you re-save.
 */

/**
 * @typedef {import('./savedStateStore.js').SavedState} SavedState
 *
 * @typedef {object} ScanProgress
 * @property {number} scanned   Photos visited so far.
 * @property {number} saved
 * @property {number} unsaved
 * @property {number} unknown   Photos whose toolbar never settled.
 * @property {number} fromCache Photos answered from the cache, with no toolbar read.
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
 * @property {number} fromCache
 * @property {'enabled' | 'disabled' | 'missing' | null} nextControlState  The next control when the walk ended.
 *
 * @typedef {object} AlbumScannerDeps
 * @property {() => string | null} readCurrentPhotoKey  Photo id currently in the address bar.
 * @property {() => 'enabled' | 'disabled' | 'missing'} readNextControlState  The state of the next-photo control.
 * @property {(attempt: number) => Promise<void>} requestNextPhoto  Ask the page to move on, one method per attempt number.
 * @property {() => SavedState | null} probe  Read the toolbar; null means "cannot tell yet".
 * @property {() => void} keepPageAwake  Make the page show its viewer chrome again.
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

/**
 * How long we wait for the address bar to show the next photo, per attempt.
 *
 * The list is also the attempt count, and it backs off on purpose. The address
 * bar usually updates as soon as the app accepts the key, so the first window is
 * short and the common case stays fast. A window only grows when the album has
 * not loaded the next page yet, and Google Photos loads a shared album in pages.
 * The whole budget is about 11 seconds, and a scan pays it only at a real stall.
 */
const ADVANCE_ATTEMPT_TIMEOUTS_MS = [1200, 2500, 2500, 5000];

/**
 * The shortest time one photo may take, in milliseconds.
 *
 * Google Photos loads a shared album in pages. Without a floor the scan steps
 * through photos every few tens of milliseconds, far faster than a person, and
 * arrives past the loaded edge, then reports a stall it caused itself.
 *
 * The floor covers every photo, whatever the answer came from. An earlier
 * version charged it only to cached photos, which made a resumed scan slower
 * than a first one once reading a photo became fast. What matters is how fast
 * the loop turns, not where the answer came from.
 */
export const MIN_PHOTO_INTERVAL_MS = 100;

/** How often we look at the address bar while waiting, in milliseconds. */
const ADVANCE_POLL_MS = 25;

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
  let fromCache = 0;

  /**
   * Reads the toolbar until the answer is trustworthy. See the note at the top
   * of this file for why the two answers are treated differently.
   * @returns {Promise<SavedState | null>}
   */
  async function readSettledState() {
    const arrivedAt = now();
    const deadline = arrivedAt + deps.timeoutMs;

    /** @type {number | null} When the current run of "no Save button" readings began. */
    let savedSince = null;

    while (now() < deadline) {
      await wait(deps.pollMs);
      const current = probe();

      if (current === null) {
        // An empty toolbar is what a hidden one looks like, and Google Photos
        // hides its viewer chrome while the pointer stays still. A scan never
        // moves the pointer, so wake the page rather than lose the photo.
        deps.keepPageAwake();
        savedSince = null;
        continue;
      }

      // A visible Save button is proof, so take it on the first reading and do
      // not wait out the dwell. This is the fast path, and in a shared album it
      // is almost every photo.
      //
      // The dwell exists because the toolbar can still belong to the previous
      // photo. Skipping it here risks only the harmless direction: a saved photo
      // badged unsaved, which costs the user one re-save that Google Photos
      // deduplicates. The costly direction is guarded below.
      if (current === 'unsaved') return 'unsaved';

      // Absence of the button is not proof. Ignore it until the dwell has
      // passed, because a stale toolbar could be hiding a Save button that
      // belongs to this photo. Then make it hold, because a toolbar that has
      // not finished drawing looks exactly the same.
      if (now() - arrivedAt < deps.minDwellMs) {
        savedSince = null;
        continue;
      }
      savedSince ??= now();
      if (now() - savedSince >= deps.confirmSavedMs) return 'saved';
    }

    return null;
  }

  /**
   * Moves to the next photo, trying each available method in turn.
   * @param {string} currentPhotoKey
   * @returns {Promise<string | null>} The new photo id, or null when nothing worked.
   */
  async function advancePastPhoto(currentPhotoKey) {
    for (const [attempt, attemptTimeoutMs] of ADVANCE_ATTEMPT_TIMEOUTS_MS.entries()) {
      // The next control is part of the chrome that hides with the pointer.
      deps.keepPageAwake();
      await requestNextPhoto(attempt);

      const deadline = now() + attemptTimeoutMs;
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
  const outcome = (reason) => ({
    reason,
    scanned: visited.size,
    saved,
    unsaved,
    unknown,
    fromCache,
    // Only meaningful when the walk could not continue, but it is cheap and it
    // is exactly what a stall report needs.
    nextControlState: reason === 'stuck' || reason === 'end-of-album' ? deps.readNextControlState() : null,
  });

  let photoKey = readCurrentPhotoKey();
  if (photoKey === null) return outcome('no-photo-open');

  for (;;) {
    if (visited.has(photoKey)) return outcome('loop-detected');
    visited.add(photoKey);

    const photoStartedAt = now();
    const cached = readCachedState(photoKey);
    const servedFromCache = !deps.rescanKnown && cached !== null;
    if (servedFromCache) fromCache += 1;
    const state = servedFromCache ? cached : await readSettledState();

    if (state === null) {
      unknown += 1;
    } else {
      if (state === 'saved') saved += 1;
      else unsaved += 1;
      onResult(photoKey, state);
    }

    onProgress({ scanned: visited.size, saved, unsaved, unknown, fromCache, photoKey });

    if (shouldStop()) return outcome('stopped');

    // Hold the floor, counting whatever this photo already spent. A photo that
    // took longer than the floor pays nothing extra. See MIN_PHOTO_INTERVAL_MS.
    const spentOnPhoto = now() - photoStartedAt;
    if (spentOnPhoto < MIN_PHOTO_INTERVAL_MS) await wait(MIN_PHOTO_INTERVAL_MS - spentOnPhoto);

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
