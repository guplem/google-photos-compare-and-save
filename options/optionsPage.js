/**
 * Reads and writes the settings shown on the options page.
 *
 * Settings live in `chrome.storage.sync` so they follow your Chrome profile.
 * The scan results live in `chrome.storage.local`, because they are large and
 * belong to one computer.
 */

import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from '../src/settings/extensionSettings.js';
import { createSavedStateStore } from '../src/savedState/savedStateStore.js';

const store = createSavedStateStore(chrome.storage.local);

/**
 * @param {string} id
 * @returns {HTMLInputElement}
 */
const input = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

/**
 * @param {string} id
 * @returns {HTMLSelectElement}
 */
const select = (id) => /** @type {HTMLSelectElement} */ (document.getElementById(id));

/**
 * @param {string} id
 * @returns {HTMLTextAreaElement}
 */
const textarea = (id) => /** @type {HTMLTextAreaElement} */ (document.getElementById(id));

/**
 * @param {string} value
 * @returns {string[]}
 */
const readLines = (value) =>
  value
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== '');

/** @param {string} message */
function showStatus(message) {
  const status = /** @type {HTMLElement} */ (document.getElementById('status'));
  status.textContent = message;
  setTimeout(() => {
    if (status.textContent === message) status.textContent = '';
  }, 3000);
}

/** @param {import('../src/settings/extensionSettings.js').ExtensionSettings} settings */
function showSettings(settings) {
  input('instantSwapEnabled').checked = settings.instantSwapEnabled;
  select('instantSwapLevel').value = settings.instantSwapLevel;
  input('patchReducedMotion').checked = settings.patchReducedMotion;
  input('clampWebAnimations').checked = settings.clampWebAnimations;
  input('savedBadgesEnabled').checked = settings.savedBadgesEnabled;
  input('dimSavedPhotos').checked = settings.dimSavedPhotos;
  input('rescanKnown').checked = settings.rescanKnown;
  input('scanPollMs').value = String(settings.scanPollMs);
  input('scanMinDwellMs').value = String(settings.scanMinDwellMs);
  input('scanConfirmSavedMs').value = String(settings.scanConfirmSavedMs);
  input('scanTimeoutMs').value = String(settings.scanTimeoutMs);
  textarea('saveLabels').value = settings.saveLabels.join('\n');
  textarea('savedLabels').value = settings.savedLabels.join('\n');
}

/** @returns {import('../src/settings/extensionSettings.js').ExtensionSettings} */
function collectSettings() {
  return normalizeSettings({
    instantSwapEnabled: input('instantSwapEnabled').checked,
    instantSwapLevel: select('instantSwapLevel').value,
    patchReducedMotion: input('patchReducedMotion').checked,
    clampWebAnimations: input('clampWebAnimations').checked,
    savedBadgesEnabled: input('savedBadgesEnabled').checked,
    dimSavedPhotos: input('dimSavedPhotos').checked,
    rescanKnown: input('rescanKnown').checked,
    scanPollMs: Number(input('scanPollMs').value),
    scanMinDwellMs: Number(input('scanMinDwellMs').value),
    scanConfirmSavedMs: Number(input('scanConfirmSavedMs').value),
    scanTimeoutMs: Number(input('scanTimeoutMs').value),
    saveLabels: readLines(textarea('saveLabels').value),
    savedLabels: readLines(textarea('savedLabels').value),
  });
}

document.getElementById('save')?.addEventListener('click', async () => {
  const saved = await saveSettings(chrome.storage.sync, collectSettings());
  showSettings(saved);
  showStatus('Saved. Reload any open Google Photos tab.');
});

document.getElementById('reset')?.addEventListener('click', async () => {
  const saved = await saveSettings(chrome.storage.sync, { ...DEFAULT_SETTINGS });
  showSettings(saved);
  showStatus('Back to the defaults.');
});

document.getElementById('clearCache')?.addEventListener('click', async () => {
  const removed = await store.clearAllAlbums();
  showStatus(removed === 0 ? 'There was nothing stored.' : `Deleted the results of ${removed} albums.`);
});

showSettings(await loadSettings(chrome.storage.sync));
