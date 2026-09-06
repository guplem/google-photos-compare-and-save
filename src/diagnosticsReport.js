/**
 * Builds the report that the control panel's "Copy diagnostics" button copies.
 *
 * The report exists because the extension reads a page it does not own. When a
 * scan behaves oddly, the only way to find out why is to see what the extension
 * saw. A user pastes this into a bug report.
 *
 * Two rules shape it.
 *
 * It must never carry an album id, a photo id, or a share key. Those identify
 * the user's private photos, and a bug report is a public place.
 *
 * It must describe the page as a scan sees it, not as a user sees it. A user
 * reads the report just after moving the mouse to click the button, and Google
 * Photos shows the viewer chrome whenever the pointer moves. So the report
 * samples the toolbar over time and says whether it disappears.
 */

/**
 * @typedef {import('./savedState/savedStateStore.js').SavedState} SavedState
 *
 * @typedef {object} ToolbarSampleSummary
 * @property {number[]} controlCounts       How many controls each sample found.
 * @property {boolean} disappearsWhenIdle   The toolbar was there and then was not.
 * @property {boolean} neverVisible         No sample found a single control.
 * @property {string[]} controlNames        Every distinct name seen, across all samples.
 *
 * @typedef {object} DiagnosticsFacts
 * @property {string} extensionVersion
 * @property {string} url
 * @property {import('./googlePhotosPage.js').GooglePhotosLocation} pageLocation
 * @property {number} gridPhotoLinks
 * @property {string[][]} toolbarSamples    One entry per sample, each a list of control names.
 * @property {SavedState | null} probeResult
 * @property {boolean} dialogOpen
 * @property {'enabled' | 'disabled' | 'missing'} nextControlState
 * @property {{ width: number, height: number }} viewport
 * @property {readonly string[]} saveLabels
 * @property {readonly string[]} savedLabels
 * @property {number} cachedPhotos
 * @property {import('./savedState/albumSavedStateScanner.js').ScanOutcome | null} lastScan
 */

/**
 * Replaces every album, share, and photo id in a URL, and drops the query and
 * the fragment. The query holds the share key, which grants access to the album.
 * @param {string} url
 * @returns {string}
 */
export function redactPhotoUrl(url) {
  return url.replace(/[?#].*$/, '').replace(/\/(album|share|photo)\/[^/?#]+/g, '/$1/<id>');
}

/**
 * @param {string[][]} samples
 * @returns {ToolbarSampleSummary}
 */
export function summarizeToolbarSamples(samples) {
  const controlCounts = samples.map((sample) => sample.length);

  // An empty sample counts only when a fuller one came before it. A toolbar that
  // was never there is a different failure from one that fades out, and the two
  // need different fixes.
  const disappearsWhenIdle = controlCounts.some(
    (count, index) => count === 0 && controlCounts.slice(0, index).some((earlier) => earlier > 0),
  );

  return {
    controlCounts,
    disappearsWhenIdle,
    neverVisible: !controlCounts.some((count) => count > 0),
    controlNames: [...new Set(samples.flat())],
  };
}

/**
 * @param {DiagnosticsFacts} facts
 */
export function buildDiagnosticsReport(facts) {
  return {
    extensionVersion: facts.extensionVersion,
    url: redactPhotoUrl(facts.url),
    pageKind: facts.pageLocation.kind,
    hasAlbumKey: facts.pageLocation.albumKey !== null,
    hasPhotoKey: facts.pageLocation.photoKey !== null,
    viewport: facts.viewport,
    gridPhotoLinks: facts.gridPhotoLinks,
    dialogOpen: facts.dialogOpen,
    nextControlState: facts.nextControlState,
    probeResult: facts.probeResult,
    toolbar: summarizeToolbarSamples(facts.toolbarSamples),
    configuredSaveLabels: [...facts.saveLabels],
    configuredSavedLabels: [...facts.savedLabels],
    cachedPhotos: facts.cachedPhotos,
    lastScan: facts.lastScan ?? 'no scan has run in this tab',
  };
}
