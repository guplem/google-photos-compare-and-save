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
import { buildDiagnosticsReport } from './diagnosticsReport.js';

/** How often we check whether the single-page app changed the address bar. */
const LOCATION_POLL_MS = 300;

/** Write cached results to storage after this many new readings. */
const WRITE_BATCH_SIZE = 10;

/** How long the virtualised album grid needs to redraw after a scroll, in milliseconds. */
const GRID_REDRAW_WAIT_MS = 500;

/**
 * How the diagnostics button samples the toolbar.
 *
 * It must run long enough to catch Google Photos hiding the viewer chrome, which
 * happens a few seconds after the pointer stops. It also must not wake the page,
 * or it would only ever see the state a user sees and never the state a scan
 * sees. The user has just moved the pointer to press the button, so the first
 * sample is the awake state and the last ones show what a scan would find.
 */
const DIAGNOSTICS_SAMPLE_COUNT = 5;
const DIAGNOSTICS_SAMPLE_GAP_MS = 1000;

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
  /** @type {import('./savedState/albumSavedStateScanner.js').ScanOutcome | null} */
  let lastScanOutcome = null;

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
   * Collects what the extension can see, over a few seconds, and reports it.
   * Paste the result into a bug report when a scan behaves oddly.
   *
   * It deliberately does not wake the page while it samples. The point is to
   * show whether the viewer chrome disappears once the pointer stops, because
   * that is the state every scan works in and the state a user never sees.
   *
   * @returns {Promise<string>}
   */
  async function buildDiagnostics() {
    /** @type {string[][]} */
    const toolbarSamples = [];
    for (let sample = 0; sample < DIAGNOSTICS_SAMPLE_COUNT; sample += 1) {
      toolbarSamples.push(collectToolbarControlNames(buildProbeDeps()));
      if (sample < DIAGNOSTICS_SAMPLE_COUNT - 1) await wait(DIAGNOSTICS_SAMPLE_GAP_MS);
    }

    const report = buildDiagnosticsReport({
      extensionVersion: chrome.runtime.getManifest().version,
      url: location.href,
      pageLocation: readGooglePhotosLocation(location.href),
      gridPhotoLinks: findGridPhotoLinks(document).length,
      toolbarSamples,
      probeResult: probeSavedState(buildProbeDeps()),
      dialogOpen: viewerNavigator.isDialogOpen(),
      nextControlState: viewerNavigator.readNextControlState(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      saveLabels: settings.saveLabels,
      savedLabels: settings.savedLabels,
      cachedPhotos: Object.keys(albumRecord.photos).length,
      lastScan: lastScanOutcome,
    });
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
    onBuildDiagnostics: async () => {
      const seconds = Math.round((DIAGNOSTICS_SAMPLE_COUNT * DIAGNOSTICS_SAMPLE_GAP_MS) / 1000);
      panel.setMessage(`Sampling the page for ${seconds} seconds. Do not move the mouse.`);
      return buildDiagnostics();
    },
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
      return (
        `Stopped after ${outcome.scanned} photos: no way to reach the next one. ` +
        `Found ${outcome.unsaved} not saved so far.${unknownNote} ` +
        `If that is the whole album, the scan is complete. If not, scan again: it resumes from here. ` +
        `If it stops at the same place twice, press Copy diagnostics.`
      );
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
        readNextControlState: () => viewerNavigator.readNextControlState(),
        requestNextPhoto: (attempt) => viewerNavigator.requestNextPhoto(attempt),
        probe: () => probeSavedState(buildProbeDeps()),
        keepPageAwake: () => viewerNavigator.keepChromeAwake(),
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

      lastScanOutcome = outcome;
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
