/**
 * Drives the Google Photos viewer: opens the first photo of an album, and moves
 * from one photo to the next.
 *
 * Safety rule for this file: never click a control we cannot name. An earlier
 * version picked whatever button sat near the right edge of the window, which
 * opened the "Edit date/time" dialog whenever the arrow key failed. A control
 * must match a known "next" word before we click it. When nothing matches, the
 * scan stops and says so, which is the safe outcome.
 */

const CONTROL_SELECTOR = 'button, [role="button"]';

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open]';

/** A "next" control sits past this share of the window width. */
const RIGHT_EDGE_FRACTION = 0.8;

/** Words that mean "next photo", in the languages Google Photos is likely to use here. */
const NEXT_CONTROL_WORDS = [
  'next',
  'siguiente',
  'següent',
  'seguent',
  'seguinte',
  'suivant',
  'weiter',
  'nächste',
  'nachste',
  'avanti',
  'prossima',
];

/**
 * @param {Window} view
 * @param {Element} element
 * @returns {boolean}
 */
function isVisible(view, element) {
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return false;
  const style = view.getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/**
 * @param {Element} element
 * @returns {string}
 */
function readControlName(element) {
  return (element.getAttribute('aria-label') ?? element.getAttribute('title') ?? element.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Moves the pointer over the right of the viewer.
 *
 * Google Photos renders the next-photo chevron only while the pointer is over
 * the photo. Without this nudge a click fallback has nothing to click, because
 * synthetic clicks never move the real pointer.
 * @param {Window} view
 */
function nudgePointerOverViewer(view) {
  const event = new MouseEvent('mousemove', {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: Math.round(view.innerWidth * 0.9),
    clientY: Math.round(view.innerHeight * 0.5),
  });
  view.document.dispatchEvent(event);
}

/**
 * @param {Window} view
 * @param {string} type
 * @param {string} key
 */
function dispatchKey(view, type, key) {
  const event = new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true, composed: true });
  // Some handlers still read the old numeric fields, which the constructor ignores.
  const numeric = key === 'ArrowRight' ? 39 : 27;
  Object.defineProperty(event, 'keyCode', { get: () => numeric });
  Object.defineProperty(event, 'which', { get: () => numeric });
  (view.document.activeElement ?? view.document.body)?.dispatchEvent(event);
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
export function createPhotoViewerNavigator(view) {
  /**
   * @param {number} milliseconds
   * @returns {Promise<void>}
   */
  const wait = (milliseconds) => new Promise((resolve) => view.setTimeout(resolve, milliseconds));

  /** @returns {HTMLElement[]} */
  function findVisibleControls() {
    return Array.from(view.document.querySelectorAll(CONTROL_SELECTOR))
      .filter((control) => isVisible(view, control))
      .map((control) => /** @type {HTMLElement} */ (control));
  }

  /**
   * A control named like a "next" control.
   * @param {boolean} requireRightEdge Also demand that it sits on the right of the window.
   * @returns {HTMLElement | null}
   */
  function findNextControl(requireRightEdge) {
    for (const control of findVisibleControls()) {
      const name = readControlName(control);
      if (name === '' || !NEXT_CONTROL_WORDS.some((word) => name.includes(word))) continue;
      if (!requireRightEdge) return control;
      const box = control.getBoundingClientRect();
      if (box.left + box.width / 2 < view.innerWidth * RIGHT_EDGE_FRACTION) continue;
      return control;
    }
    return null;
  }

  return {
    /**
     * Reports whether the viewer still offers a next photo.
     *
     * The scan uses this to tell a finished album from a stall. Both look the
     * same otherwise: Google Photos keeps the viewer open on the last photo, so
     * the address bar never changes and never clears.
     *
     * Only `disabled` is positive evidence of the end. `missing` stays
     * ambiguous on purpose, because a control can also be absent while the page
     * is still drawing.
     *
     * @returns {'enabled' | 'disabled' | 'missing'}
     */
    readNextControlState() {
      // The right-edge rule guards a click, not a read, so it does not apply here.
      const control = findNextControl(false);
      if (control === null) return 'missing';
      const disabled =
        control.getAttribute('aria-disabled') === 'true' ||
        control.hasAttribute('disabled') ||
        control.getAttribute('aria-hidden') === 'true';
      return disabled ? 'disabled' : 'enabled';
    },

    /** @returns {boolean} True while a modal dialog covers the viewer. */
    isDialogOpen() {
      return Array.from(view.document.querySelectorAll(DIALOG_SELECTOR)).some((dialog) => isVisible(view, dialog));
    },

    /** Closes whatever dialog is open, so the scan never types into one. */
    closeDialog() {
      dispatchKey(view, 'keydown', 'Escape');
      dispatchKey(view, 'keyup', 'Escape');
    },

    /**
     * Opens the first photo of the album.
     *
     * The grid is virtualised, so the first `<a>` in the document is whichever
     * one Google Photos happened to reuse last, not the first photo. We scroll
     * the grid back to the top and then take the thumbnail that is highest on
     * screen, and leftmost among those.
     *
     * @param {number} renderWaitMs How long to let the grid redraw after scrolling.
     * @returns {Promise<boolean>} False when the page shows no thumbnails.
     */
    async openFirstPhoto(renderWaitMs) {
      const anyLink = view.document.querySelector('a[href*="/photo/"]');
      if (anyLink === null) return false;

      findScrollingAncestor(view, anyLink)?.scrollTo({ top: 0, behavior: 'instant' });
      view.scrollTo({ top: 0, behavior: 'instant' });
      await wait(renderWaitMs);

      const links = Array.from(view.document.querySelectorAll('a[href*="/photo/"]'))
        .filter((link) => isVisible(view, link))
        .map((link) => ({ link, box: link.getBoundingClientRect() }))
        // Reading order: top row first, then left to right. Rows are never
        // pixel-aligned, so compare the tops with a small tolerance.
        .sort((a, b) => (Math.abs(a.box.top - b.box.top) > 4 ? a.box.top - b.box.top : a.box.left - b.box.left));

      const first = links[0];
      if (first === undefined) return false;

      /** @type {HTMLElement} */ (first.link).click();
      return true;
    },

    /**
     * Asks the page to show the next photo.
     *
     * Even attempts send the arrow key; odd attempts click the named control.
     * The two methods alternate so that a failure of one never blocks the other,
     * and the caller grows its waiting window on each attempt.
     * @param {number} attempt
     * @returns {Promise<void>}
     */
    async requestNextPhoto(attempt) {
      // A dialog swallows the arrow key and hides the toolbar, so clear it first.
      if (this.isDialogOpen()) {
        this.closeDialog();
        await wait(120);
      }

      if (attempt % 2 === 0) {
        dispatchKey(view, 'keydown', 'ArrowRight');
        dispatchKey(view, 'keyup', 'ArrowRight');
        return;
      }

      nudgePointerOverViewer(view);
      await wait(120);
      findNextControl(true)?.click();
    },

    /** Leaves the viewer and goes back to the grid. */
    closeViewer() {
      dispatchKey(view, 'keydown', 'Escape');
      dispatchKey(view, 'keyup', 'Escape');
    },
  };
}

/** @typedef {ReturnType<typeof createPhotoViewerNavigator>} PhotoViewerNavigator */
