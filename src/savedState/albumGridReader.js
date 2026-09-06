/**
 * Reads the album grid to decide where a scan should start.
 *
 * The grid is virtualised: Google Photos renders about thirty thumbnails and
 * recycles them as you scroll, so the page never holds the whole album at once.
 * To find the first photo that has not been checked, the reader scrolls the grid
 * in steps and collects the photo ids that appear, and it stops as soon as it
 * sees one that is not in the cache.
 *
 * That matters because a scan that starts at the first photo walks past every
 * photo it already knows before it reaches new work. On an album with hundreds
 * of checked photos that is minutes of nothing.
 *
 * The two decisions in this file are pure and tested. Only `createAlbumGridReader`
 * touches the DOM.
 */

import { readPhotoKeyFromLink } from '../googlePhotosPage.js';

/** How far to scroll each step, as a share of the visible height. Overlap avoids skipping a row. */
const SCROLL_STEP_FRACTION = 0.8;

/**
 * @typedef {{ mode: 'start-at', photoKey: string }
 *   | { mode: 'rescan-all', photoKey: string }
 *   | { mode: 'no-photos' }} ScanStartPlan
 */

/**
 * Appends the ids it has not seen, keeping the order they first appeared in.
 * Scroll steps overlap, so the same thumbnail arrives several times.
 * @param {readonly string[]} existing
 * @param {readonly string[]} incoming
 * @returns {string[]}
 */
export function mergeOrderedPhotoKeys(existing, incoming) {
  const seen = new Set(existing);
  const merged = [...existing];
  for (const photoKey of incoming) {
    if (seen.has(photoKey)) continue;
    seen.add(photoKey);
    merged.push(photoKey);
  }
  return merged;
}

/**
 * Decides where the scan should start.
 *
 * @param {readonly string[]} orderedPhotoKeys  Album order, as far as the reader got.
 * @param {(photoKey: string) => boolean} isKnown
 * @param {boolean} reachedBottom  Whether the reader saw the end of the grid.
 * @returns {ScanStartPlan}
 */
export function chooseScanStart(orderedPhotoKeys, isKnown, reachedBottom) {
  const firstUnknown = orderedPhotoKeys.find((photoKey) => !isKnown(photoKey));
  if (firstUnknown !== undefined) return { mode: 'start-at', photoKey: firstUnknown };

  const first = orderedPhotoKeys[0];
  const last = orderedPhotoKeys[orderedPhotoKeys.length - 1];
  if (first === undefined || last === undefined) return { mode: 'no-photos' };

  // Every photo is known. Only the bottom of the grid makes that mean "the whole
  // album", so read it all again. Otherwise the reader simply ran out of steps,
  // and the last photo it saw is a far better start than the first.
  return reachedBottom ? { mode: 'rescan-all', photoKey: first } : { mode: 'start-at', photoKey: last };
}

/**
 * @param {Window} view
 * @param {Element} element
 * @returns {boolean}
 */
function isVisible(view, element) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && view.getComputedStyle(element).visibility !== 'hidden';
}

/**
 * Finds the element that actually scrolls the album grid. Google Photos scrolls
 * an inner container, so `window.scrollTo` alone does nothing.
 * @param {Window} view
 * @param {Element} start
 * @returns {Element | null}
 */
function findScrollingAncestor(view, start) {
  for (let element = start.parentElement; element !== null; element = element.parentElement) {
    if (element.scrollHeight <= element.clientHeight + 1) continue;
    const overflowY = view.getComputedStyle(element).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return element;
  }
  return null;
}

/**
 * @param {Window} view
 */
export function createAlbumGridReader(view) {
  /**
   * @param {number} milliseconds
   * @returns {Promise<void>}
   */
  const wait = (milliseconds) => new Promise((resolve) => view.setTimeout(resolve, milliseconds));

  /**
   * The ids of the thumbnails on screen, in reading order: top row first, then
   * left to right. Rows are never pixel-aligned, so tops compare with tolerance.
   * @returns {string[]}
   */
  function readVisiblePhotoKeys() {
    return Array.from(view.document.querySelectorAll('a[href*="/photo/"]'))
      .filter((link) => isVisible(view, link))
      .map((link) => ({ link: /** @type {HTMLAnchorElement} */ (link), box: link.getBoundingClientRect() }))
      .sort((a, b) => (Math.abs(a.box.top - b.box.top) > 4 ? a.box.top - b.box.top : a.box.left - b.box.left))
      .map((entry) => readPhotoKeyFromLink(entry.link))
      .filter((photoKey) => photoKey !== null);
  }

  return {
    /**
     * Scrolls the grid until it finds a photo that is not in the cache, or until
     * it reaches the bottom or runs out of steps.
     *
     * @param {object} options
     * @param {(photoKey: string) => boolean} options.isKnown
     * @param {number} options.stepWaitMs  How long the grid needs to redraw after a scroll.
     * @param {number} options.maxSteps    A guard, so a huge album cannot loop forever.
     * @param {(count: number) => void} [options.onProgress]
     * @returns {Promise<ScanStartPlan>}
     */
    async planScanStart({ isKnown, stepWaitMs, maxSteps, onProgress }) {
      const anyLink = view.document.querySelector('a[href*="/photo/"]');
      if (anyLink === null) return { mode: 'no-photos' };

      const scroller = findScrollingAncestor(view, anyLink);
      scroller?.scrollTo({ top: 0, behavior: 'instant' });
      view.scrollTo({ top: 0, behavior: 'instant' });
      await wait(stepWaitMs);

      /** @type {string[]} */
      let orderedPhotoKeys = [];
      let reachedBottom = false;

      for (let step = 0; step < maxSteps; step += 1) {
        orderedPhotoKeys = mergeOrderedPhotoKeys(orderedPhotoKeys, readVisiblePhotoKeys());
        onProgress?.(orderedPhotoKeys.length);

        // Stop the moment there is new work to do; there is no reason to read
        // the rest of the album.
        if (orderedPhotoKeys.some((photoKey) => !isKnown(photoKey))) break;

        if (scroller === null) {
          reachedBottom = true;
          break;
        }
        const before = scroller.scrollTop;
        scroller.scrollBy({ top: scroller.clientHeight * SCROLL_STEP_FRACTION, behavior: 'instant' });
        await wait(stepWaitMs);
        // A scroll that moved nothing means the grid has no more rows below.
        if (scroller.scrollTop <= before + 1) {
          orderedPhotoKeys = mergeOrderedPhotoKeys(orderedPhotoKeys, readVisiblePhotoKeys());
          reachedBottom = true;
          break;
        }
      }

      return chooseScanStart(orderedPhotoKeys, isKnown, reachedBottom);
    },

    /**
     * Opens one photo by its id, when its thumbnail is on screen.
     * @param {string} photoKey
     * @returns {boolean} False when the grid no longer renders that thumbnail.
     */
    openPhotoByKey(photoKey) {
      for (const link of view.document.querySelectorAll('a[href*="/photo/"]')) {
        const candidate = /** @type {HTMLAnchorElement} */ (link);
        if (readPhotoKeyFromLink(candidate) !== photoKey || !isVisible(view, candidate)) continue;
        candidate.click();
        return true;
      }
      return false;
    },
  };
}

/** @typedef {ReturnType<typeof createAlbumGridReader>} AlbumGridReader */
