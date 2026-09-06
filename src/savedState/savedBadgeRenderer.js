/**
 * Draws a badge on the album grid for every photo that is not in your library yet.
 *
 * The grid is virtualised: Google Photos reuses the same link elements for
 * different photos as you scroll. So we cannot decorate once and walk away. We
 * watch the grid for changes and redraw, and we stamp each link with the state
 * it currently shows so a redraw costs almost nothing when nothing changed.
 */

import { findGridPhotoLinks, readPhotoKeyFromLink } from '../googlePhotosPage.js';

const BADGE_CLASS = 'gpcs-badge';
const STATE_ATTRIBUTE = 'data-gpcs-state';
const POSITIONED_ATTRIBUTE = 'data-gpcs-positioned';

/**
 * @typedef {import('./savedStateStore.js').SavedState} SavedState
 *
 * @typedef {object} SavedBadgeRendererDeps
 * @property {Document} document
 * @property {(photoKey: string) => SavedState | null} readState
 * @property {() => boolean} isEnabled
 */

/**
 * @param {Document} ownerDocument
 * @returns {SVGSVGElement}
 */
function createUnsavedIcon(ownerDocument) {
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const svg = ownerDocument.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  // A downward arrow dropping into a tray: "this one still needs saving".
  const arrow = ownerDocument.createElementNS(svgNamespace, 'path');
  arrow.setAttribute('d', 'M12 3v10m0 0 4-4m-4 4-4-4');
  const tray = ownerDocument.createElementNS(svgNamespace, 'path');
  tray.setAttribute('d', 'M4 16v2.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V16');

  svg.append(arrow, tray);
  return svg;
}

/**
 * @param {SavedBadgeRendererDeps} deps
 */
export function createSavedBadgeRenderer({ document: ownerDocument, readState, isEnabled }) {
  /** @type {MutationObserver | null} */
  let observer = null;
  /** @type {number | null} */
  let scheduledFrame = null;

  /**
   * @param {HTMLAnchorElement} link
   * @param {'saved' | 'unsaved' | 'unknown'} state
   */
  function applyState(link, state) {
    if (link.getAttribute(STATE_ATTRIBUTE) === state) return;
    link.setAttribute(STATE_ATTRIBUTE, state);

    const existingBadge = link.querySelector(`:scope > .${BADGE_CLASS}`);
    if (state !== 'unsaved') {
      existingBadge?.remove();
      return;
    }
    if (existingBadge !== null) return;

    // The badge is positioned inside the link, so the link must be a
    // positioning parent. Turning `static` into `relative` moves nothing.
    if (ownerDocument.defaultView?.getComputedStyle(link).position === 'static') {
      link.style.position = 'relative';
      link.setAttribute(POSITIONED_ATTRIBUTE, 'true');
    }

    const badge = ownerDocument.createElement('span');
    badge.className = BADGE_CLASS;
    badge.title = 'Not saved to your library';
    badge.append(createUnsavedIcon(ownerDocument));
    link.append(badge);
  }

  /** Redraws every thumbnail currently in the page. */
  function refresh() {
    if (!isEnabled()) {
      // Touch only the links we decorated. This runs on every grid change, and
      // an album grid holds hundreds of links.
      for (const link of ownerDocument.querySelectorAll(`a[${STATE_ATTRIBUTE}]`)) {
        clearLink(/** @type {HTMLAnchorElement} */ (link));
      }
      return;
    }

    for (const link of findGridPhotoLinks(ownerDocument)) {
      const photoKey = readPhotoKeyFromLink(link);
      applyState(link, photoKey === null ? 'unknown' : (readState(photoKey) ?? 'unknown'));
    }
  }

  /** @param {HTMLAnchorElement} link */
  function clearLink(link) {
    link.querySelector(`:scope > .${BADGE_CLASS}`)?.remove();
    link.removeAttribute(STATE_ATTRIBUTE);
    if (link.hasAttribute(POSITIONED_ATTRIBUTE)) {
      link.style.removeProperty('position');
      link.removeAttribute(POSITIONED_ATTRIBUTE);
    }
  }

  /** Collapses a burst of grid changes into one redraw per animation frame. */
  function scheduleRefresh() {
    const view = ownerDocument.defaultView;
    if (view === null || scheduledFrame !== null) return;
    scheduledFrame = view.requestAnimationFrame(() => {
      scheduledFrame = null;
      refresh();
    });
  }

  return {
    refresh,

    start() {
      if (observer !== null) return;
      observer = new MutationObserver(scheduleRefresh);
      observer.observe(ownerDocument.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href'],
      });
      ownerDocument.defaultView?.addEventListener('scroll', scheduleRefresh, { passive: true, capture: true });
      refresh();
    },

    stop() {
      observer?.disconnect();
      observer = null;
      ownerDocument.defaultView?.removeEventListener('scroll', scheduleRefresh, { capture: true });
      for (const link of findGridPhotoLinks(ownerDocument)) clearLink(link);
    },
  };
}

/** @typedef {ReturnType<typeof createSavedBadgeRenderer>} SavedBadgeRenderer */
