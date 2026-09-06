/**
 * The small panel that appears at the bottom left of an album page.
 *
 * It shows how many photos of this album are missing from your library, starts
 * and stops a scan, and copies a diagnostics report. The report matters: if
 * Google renames the "Save" button, the report says exactly which button names
 * the extension did find, which is all you need to fix the label list.
 */

const ROOT_CLASS = 'gpcs-root';

/**
 * @typedef {object} ControlPanelDeps
 * @property {Document} document
 * @property {() => void} onScanStart
 * @property {() => void} onScanStop
 * @property {() => void} onOpenOptions
 * @property {() => Promise<string>} onBuildDiagnostics
 */

/**
 * @param {Document} ownerDocument
 * @param {string} tagName
 * @param {string} className
 * @param {string} [text]
 */
function createElement(ownerDocument, tagName, className, text) {
  const element = ownerDocument.createElement(tagName);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/**
 * @param {ControlPanelDeps} deps
 */
export function createControlPanel({ document: ownerDocument, onScanStart, onScanStop, onOpenOptions, onBuildDiagnostics }) {
  const root = createElement(ownerDocument, 'div', ROOT_CLASS);
  root.setAttribute('data-gpcs-collapsed', 'true');

  const toggle = createElement(ownerDocument, 'button', 'gpcs-toggle', 'Compare & Save');
  toggle.setAttribute('type', 'button');

  const body = createElement(ownerDocument, 'div', 'gpcs-body');
  const summary = createElement(ownerDocument, 'p', 'gpcs-summary', 'No photos checked in this album yet.');
  const message = createElement(ownerDocument, 'p', 'gpcs-message');

  const scanButton = createElement(ownerDocument, 'button', 'gpcs-button gpcs-button--primary', 'Scan album');
  scanButton.setAttribute('type', 'button');

  const diagnosticsButton = createElement(ownerDocument, 'button', 'gpcs-button', 'Copy diagnostics');
  diagnosticsButton.setAttribute('type', 'button');

  const optionsButton = createElement(ownerDocument, 'button', 'gpcs-button', 'Options');
  optionsButton.setAttribute('type', 'button');

  const actions = createElement(ownerDocument, 'div', 'gpcs-actions');
  actions.append(scanButton, diagnosticsButton, optionsButton);
  body.append(summary, message, actions);
  root.append(toggle, body);

  /** @type {'idle' | 'scanning'} */
  let scanState = 'idle';

  toggle.addEventListener('click', () => {
    const collapsed = root.getAttribute('data-gpcs-collapsed') === 'true';
    root.setAttribute('data-gpcs-collapsed', collapsed ? 'false' : 'true');
  });

  scanButton.addEventListener('click', () => {
    if (scanState === 'scanning') onScanStop();
    else onScanStart();
  });

  optionsButton.addEventListener('click', onOpenOptions);

  diagnosticsButton.addEventListener('click', async () => {
    const report = await onBuildDiagnostics();
    try {
      await ownerDocument.defaultView?.navigator.clipboard.writeText(report);
      panel.setMessage('Diagnostics copied to the clipboard.');
    } catch {
      // Clipboard access can be refused when the tab is not focused.
      console.info('[Compare & Save] diagnostics report:\n' + report);
      panel.setMessage('Clipboard refused. The report is in the browser console.');
    }
  });

  const panel = {
    mount() {
      if (!root.isConnected) ownerDocument.body.append(root);
    },

    unmount() {
      root.remove();
    },

    /** @param {boolean} collapsed */
    setCollapsed(collapsed) {
      root.setAttribute('data-gpcs-collapsed', collapsed ? 'true' : 'false');
    },

    /** @param {import('../savedState/savedStateStore.js').AlbumSavedStateSummary} value */
    setSummary({ known, saved, unsaved }) {
      summary.textContent =
        known === 0 ? 'No photos checked in this album yet.' : `${unsaved} not saved, ${saved} saved, out of ${known} checked.`;
    },

    /** @param {'idle' | 'scanning'} next */
    setScanState(next) {
      scanState = next;
      scanButton.textContent = next === 'scanning' ? 'Stop scan' : 'Scan album';
      root.setAttribute('data-gpcs-scanning', next === 'scanning' ? 'true' : 'false');
      if (next === 'scanning') panel.setCollapsed(false);
    },

    /** @param {string} text */
    setMessage(text) {
      message.textContent = text;
    },
  };

  return panel;
}

/** @typedef {ReturnType<typeof createControlPanel>} ControlPanel */
