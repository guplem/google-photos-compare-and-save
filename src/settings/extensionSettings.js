/**
 * All user settings, their defaults, and the reading and writing helpers.
 *
 * The storage area is passed in instead of read from `chrome` directly, so the
 * pure logic in this file can be unit tested without a browser.
 */

/**
 * @typedef {'transitions' | 'transitions-and-animations'} InstantSwapLevel
 *
 * @typedef {object} ExtensionSettings
 * @property {boolean} instantSwapEnabled       Shorten the slide between photos.
 * @property {InstantSwapLevel} instantSwapLevel Which CSS motion to shorten.
 * @property {boolean} patchReducedMotion       Tell the page the viewer wants less motion.
 * @property {boolean} clampWebAnimations       Shorten JavaScript-driven animations too.
 * @property {boolean} savedBadgesEnabled       Draw a badge on photos you have not saved.
 * @property {boolean} dimSavedPhotos           Fade the photos you already saved.
 * @property {string[]} saveLabels              Button names that mean "not saved yet".
 * @property {string[]} savedLabels             Button names that mean "already saved".
 * @property {number} scanPollMs                How often to read the toolbar.
 * @property {number} scanMinDwellMs            Ignore readings taken this soon after each photo opens.
 * @property {number} scanConfirmSavedMs        How long "no Save button" must hold before we believe it.
 * @property {number} scanTimeoutMs             Give up on one photo after this long.
 * @property {boolean} rescanKnown              Read photos again even when already in the cache.
 */

/** @type {Readonly<ExtensionSettings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  instantSwapEnabled: true,
  instantSwapLevel: /** @type {InstantSwapLevel} */ ('transitions'),
  patchReducedMotion: true,
  clampWebAnimations: false,
  savedBadgesEnabled: true,
  dimSavedPhotos: false,
  saveLabels: [
    'save',
    'save to library',
    'add to library',
    'guardar',
    'guardar en la biblioteca',
    'anadir a la biblioteca',
    'desa',
    'desar',
    'afegeix a la biblioteca',
  ],
  savedLabels: ['saved', 'guardado', 'guardada', 'desat', 'desada', 'in your library', 'en tu biblioteca'],
  scanPollMs: 40,
  scanMinDwellMs: 150,
  scanConfirmSavedMs: 300,
  scanTimeoutMs: 4000,
  rescanKnown: false,
});

export const SETTINGS_STORAGE_KEY = 'settings:v1';

const INSTANT_SWAP_LEVELS = ['transitions', 'transitions-and-animations'];

/**
 * Drops unknown keys and replaces wrong or missing values with the default.
 * Storage can hold anything, including settings written by an older version.
 * @param {unknown} stored
 * @returns {ExtensionSettings}
 */
export function normalizeSettings(stored) {
  const raw = stored !== null && typeof stored === 'object' ? /** @type {Record<string, unknown>} */ (stored) : {};

  /**
   * @param {keyof ExtensionSettings} key
   * @returns {boolean}
   */
  const readBoolean = (key) =>
    typeof raw[key] === 'boolean' ? /** @type {boolean} */ (raw[key]) : /** @type {boolean} */ (DEFAULT_SETTINGS[key]);

  /**
   * @param {keyof ExtensionSettings} key
   * @param {number} minimum
   * @param {number} maximum
   * @returns {number}
   */
  const readNumber = (key, minimum, maximum) => {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return /** @type {number} */ (DEFAULT_SETTINGS[key]);
    return Math.min(Math.max(Math.round(value), minimum), maximum);
  };

  /**
   * @param {keyof ExtensionSettings} key
   * @returns {string[]}
   */
  const readLabels = (key) => {
    const value = raw[key];
    if (!Array.isArray(value)) return [.../** @type {string[]} */ (DEFAULT_SETTINGS[key])];
    const labels = value
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    return labels.length > 0 ? labels : [.../** @type {string[]} */ (DEFAULT_SETTINGS[key])];
  };

  const level = raw.instantSwapLevel;

  return {
    instantSwapEnabled: readBoolean('instantSwapEnabled'),
    instantSwapLevel: /** @type {InstantSwapLevel} */ (
      typeof level === 'string' && INSTANT_SWAP_LEVELS.includes(level) ? level : DEFAULT_SETTINGS.instantSwapLevel
    ),
    patchReducedMotion: readBoolean('patchReducedMotion'),
    clampWebAnimations: readBoolean('clampWebAnimations'),
    savedBadgesEnabled: readBoolean('savedBadgesEnabled'),
    dimSavedPhotos: readBoolean('dimSavedPhotos'),
    saveLabels: readLabels('saveLabels'),
    savedLabels: readLabels('savedLabels'),
    scanPollMs: readNumber('scanPollMs', 20, 1000),
    scanMinDwellMs: readNumber('scanMinDwellMs', 0, 3000),
    scanConfirmSavedMs: readNumber('scanConfirmSavedMs', 50, 5000),
    scanTimeoutMs: readNumber('scanTimeoutMs', 500, 30000),
    rescanKnown: readBoolean('rescanKnown'),
  };
}

/**
 * @param {chrome.storage.StorageArea} storageArea
 * @returns {Promise<ExtensionSettings>}
 */
export async function loadSettings(storageArea) {
  const stored = await storageArea.get(SETTINGS_STORAGE_KEY);
  return normalizeSettings(stored[SETTINGS_STORAGE_KEY]);
}

/**
 * @param {chrome.storage.StorageArea} storageArea
 * @param {Partial<ExtensionSettings>} changes
 * @returns {Promise<ExtensionSettings>}
 */
export async function saveSettings(storageArea, changes) {
  const current = await loadSettings(storageArea);
  const next = normalizeSettings({ ...current, ...changes });
  await storageArea.set({ [SETTINGS_STORAGE_KEY]: next });
  return next;
}
