/**
 * Entry point of the page half of the extension. Runs in the isolated world, so
 * it can use `chrome.*` APIs and can read the DOM, but cannot see the page's own
 * JavaScript variables.
 *
 * Responsibilities, in order:
 *   1. Publish the settings on the <html> element, where the stylesheets and the
 *      MAIN world patch read them.
 *   2. Follow the single-page-app navigation and keep track of which album and
 *      photo are open.
 *   3. Remember the saved state of each photo you visit, and scan a whole album
 *      in one go on request.
 *   4. Draw the badges and the control panel.
 */

import { DEFAULT_SETTINGS, loadSettings } from './settings/extensionSettings.js';
import { isAlbumContext, readGooglePhotosLocation, findGridPhotoLinks } from './googlePhotosPage.js';
import { createSavedStateStore, summarizeAlbumRecord, createEmptyAlbumRecord } from './savedState/savedStateStore.js';
import { collectToolbarControlNames, createDomProbeHelpers, probeSavedState } from './savedState/savedStateProbe.js';
import { createPhotoViewerNavigator } from './savedState/photoViewerNavigator.js';
import { scanAlbumSavedState } from './savedState/albumSavedStateScanner.js';
import { createSavedBadgeRenderer } from './savedState/savedBadgeRenderer.js';
import { createControlPanel } from './controlPanel/controlPanelController.js';

/** How often we check whether the single-page app changed the address bar. */
const LOCATION_POLL_MS = 300;

/** Write cached results to storage after this many new readings. */
const WRITE_BATCH_SIZE = 10;

/** How long the virtualised album grid needs to redraw after a scroll, in milliseconds. */
const GRID_REDRAW_WAIT_MS = 500;

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * The content script starts before <body> exists.
 * @returns {Promise<void>}
 */
function waitForBody() {
  if (document.body !== null) return Promise.resolve();
  return new Promise((resolve) => {
    new MutationObserver((_records, observer) => {
      if (document.body === null) return;
      observer.disconnect();
      resolve();
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}

export async function start() {
  const store = createSavedStateStore(chrome.storage.local);
  const viewerNavigator = createPhotoViewerNavigator(window);

  /** @type {import('./settings/extensionSettings.js').ExtensionSettings} */
  let settings = DEFAULT_SETTINGS;
  /** @type {import('./savedState/savedStateStore.js').AlbumSavedStateRecord} */
  let albumRecord = createEmptyAlbumRecord('');
  let scanning = false;
  let stopRequested = false;
  let lastHref = '';

  /** @type {Map<string, import('./savedState/savedStateStore.js').SavedState>} */
  const unwrittenResults = new Map();

  /**
   * Puts the settings where the stylesheets and the MAIN world script read them.
   * @param {import('./settings/extensionSettings.js').ExtensionSettings} next
   */
  function publishSettings(next) {
    const root = document.documentElement;

    if (next.instantSwapEnabled) root.setAttribute('data-gpcs-instant-swap', next.instantSwapLevel);
    else root.removeAttribute('data-gpcs-instant-swap');

    if (next.savedBadgesEnabled && next.dimSavedPhotos) root.setAttribute('data-gpcs-dim-saved', 'on');
    else root.removeAttribute('data-gpcs-dim-saved');

    root.setAttribute(
      'data-gpcs-main-world',
      JSON.stringify({ patchReducedMotion: next.patchReducedMotion, clampWebAnimations: next.clampWebAnimations }),
    );
  }

  /** @returns {import('./savedState/savedStateProbe.js').ToolbarProbeDeps} */
  function buildProbeDeps() {
    const helpers = createDomProbeHelpers(window);
    return {
      root: document,
      saveLabels: settings.saveLabels,
      savedLabels: settings.savedLabels,
      isVisible: helpers.isVisible,
      isInToolbar: helpers.isInToolbar,
      isBlocked: () => viewerNavigator.isDialogOpen(),
    };
  }

  /**
   * @param {string} photoKey
   * @returns {import('./savedState/savedStateStore.js').SavedState | null}
   */
  function readCachedState(photoKey) {
    return albumRecord.photos[photoKey]?.state ?? null;
  }

  const badgeRenderer = createSavedBadgeRenderer({
    document,
    readState: readCachedState,
    isEnabled: () => settings.savedBadgesEnabled,
  });

  /**
   * @param {string} photoKey
   * @param {import('./savedState/savedStateStore.js').SavedState} state
   */
  function recordResult(photoKey, state) {
    albumRecord.photos[photoKey] = { state, checkedAt: Date.now() };
    unwrittenResults.set(photoKey, state);
    badgeRenderer.refresh();
  }

  /**
   * @param {boolean} force  Write even when the batch is not full yet.
   * @returns {Promise<void>}
   */
  async function flushResults(force) {
    if (unwrittenResults.size === 0) return;
    if (!force && unwrittenResults.size < WRITE_BATCH_SIZE) return;

    const albumKey = readGooglePhotosLocation(location.href).albumKey;
    if (albumKey === null) return;

    const batch = new Map(unwrittenResults);
    unwrittenResults.clear();
    albumRecord = await store.mergePhotoStates(albumKey, batch);
    panel.setSummary(summarizeAlbumRecord(albumRecord));
  }

  /**
   * Collects what the extension can see right now. Paste this into a bug report
   * when a button name changes and the badges stop being correct.
   * @returns {string}
   */
  function buildDiagnosticsReport() {
    const pageLocation = readGooglePhotosLocation(location.href);
    const report = {
      extensionVersion: chrome.runtime.getManifest().version,
      // The photo and album ids are private, so only their presence is reported.
      url: location.href.replace(/\/(album|share|photo)\/[^/?#]+/g, '/$1/<id>').replace(/[?#].*$/, ''),
      pageKind: pageLocation.kind,
      hasAlbumKey: pageLocation.albumKey !== null,
      hasPhotoKey: pageLocation.photoKey !== null,
      gridPhotoLinks: findGridPhotoLinks(document).length,
      toolbarControlNames: collectToolbarControlNames(buildProbeDeps()),
      probeResult: probeSavedState(buildProbeDeps()),
      configuredSaveLabels: settings.saveLabels,
      configuredSavedLabels: settings.savedLabels,
      cachedPhotos: Object.keys(albumRecord.photos).length,
    };
    return JSON.stringify(report, null, 2);
  }

  const panel = createControlPanel({
    document,
    onScanStart: () => void runScan(),
    onScanStop: () => {
      stopRequested = true;
      panel.setMessage('Stopping after the current photo.');
    },
    onOpenOptions: () => void chrome.runtime.sendMessage({ type: 'open-options' }),
    onBuildDiagnostics: async () => buildDiagnosticsReport(),
  });

  /**
   * Records the state of the photo the viewer shows right now, so that browsing
   * an album by hand fills the cache without any scan.
   * @param {string} photoKey
   * @returns {Promise<void>}
   */
  async function probeCurrentPhoto(photoKey) {
    await wait(settings.scanMinDwellMs + settings.scanConfirmSavedMs);
    if (readGooglePhotosLocation(location.href).photoKey !== photoKey) return;

    const state = probeSavedState(buildProbeDeps());
    if (state === null || readCachedState(photoKey) === state) return;

    recordResult(photoKey, state);
    await flushResults(true);
  }

  /**
   * @param {import('./savedState/albumSavedStateScanner.js').ScanOutcome} outcome
   * @returns {string}
   */
  function describeOutcome(outcome) {
    const unknownNote = outcome.unknown > 0 ? ` ${outcome.unknown} could not be read.` : '';
    if (outcome.reason === 'stopped') return `Stopped after ${outcome.scanned} photos.${unknownNote}`;
    if (outcome.reason === 'no-photo-open') return 'Could not open the viewer.';
    if (outcome.reason === 'stuck') {
      return `Stopped at photo ${outcome.scanned}: could not reach the next photo. Use Copy diagnostics.`;
    }
    return `Done. ${outcome.unsaved} of ${outcome.scanned} photos are not saved.${unknownNote}`;
  }

  /** @returns {Promise<void>} */
  async function runScan() {
    if (scanning) return;

    const albumKey = readGooglePhotosLocation(location.href).albumKey;
    if (albumKey === null) {
      panel.setMessage('Open an album first.');
      return;
    }

    scanning = true;
    stopRequested = false;
    panel.setScanState('scanning');
    panel.setMessage('Starting.');

    try {
      if (readGooglePhotosLocation(location.href).photoKey === null) {
        panel.setMessage('Going back to the first photo.');
        if (!(await viewerNavigator.openFirstPhoto(GRID_REDRAW_WAIT_MS))) {
          panel.setMessage('No photos found on this page.');
          return;
        }
        await wait(GRID_REDRAW_WAIT_MS);
      }

      const startedAt = Date.now();

      const outcome = await scanAlbumSavedState({
        readCurrentPhotoKey: () => readGooglePhotosLocation(location.href).photoKey,
        requestNextPhoto: (attempt) => viewerNavigator.requestNextPhoto(attempt),
        probe: () => probeSavedState(buildProbeDeps()),
        wait,
        now: () => Date.now(),
        readCachedState,
        onResult: recordResult,
        onProgress: (progress) => {
          const perPhoto = Math.round((Date.now() - startedAt) / progress.scanned);
          panel.setMessage(
            `Checked ${progress.scanned}: ${progress.unsaved} not saved, ${progress.saved} saved. ${perPhoto}ms each.`,
          );
          void flushResults(false);
        },
        shouldStop: () => stopRequested,
        pollMs: settings.scanPollMs,
        minDwellMs: settings.scanMinDwellMs,
        confirmSavedMs: settings.scanConfirmSavedMs,
        timeoutMs: settings.scanTimeoutMs,
        rescanKnown: settings.rescanKnown,
      });

      await flushResults(true);
      panel.setMessage(describeOutcome(outcome));
      if (outcome.reason === 'end-of-album') viewerNavigator.closeViewer();
    } catch (error) {
      console.error('[Compare & Save] scan failed', error);
      panel.setMessage('The scan failed. See the browser console.');
    } finally {
      scanning = false;
      panel.setScanState('idle');
    }
  }

  /** @returns {Promise<void>} */
  async function onLocationChanged() {
    const pageLocation = readGooglePhotosLocation(location.href);

    if (!isAlbumContext(pageLocation)) {
      panel.unmount();
      badgeRenderer.stop();
      albumRecord = createEmptyAlbumRecord('');
      return;
    }

    const albumKey = /** @type {string} */ (pageLocation.albumKey);
    if (albumRecord.albumKey !== albumKey) albumRecord = await store.readAlbum(albumKey);

    panel.mount();
    panel.setSummary(summarizeAlbumRecord(albumRecord));
    badgeRenderer.start();
    badgeRenderer.refresh();

    if (!scanning && pageLocation.photoKey !== null) void probeCurrentPhoto(pageLocation.photoKey);
  }

  /**
   * Google Photos is a single-page app: it rewrites the address bar without
   * loading a new page. Polling catches every one of those changes, including
   * the ones that fire no event.
   */
  function watchLocation() {
    const check = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      void onLocationChanged();
    };
    window.addEventListener('popstate', check);
    setInterval(check, LOCATION_POLL_MS);
    check();
  }

  settings = await loadSettings(chrome.storage.sync);
  publishSettings(settings);

  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName !== 'sync') return;
    void loadSettings(chrome.storage.sync).then((next) => {
      settings = next;
      publishSettings(next);
      badgeRenderer.refresh();
    });
  });

  await waitForBody();
  watchLocation();
}
