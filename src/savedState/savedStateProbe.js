/**
 * Reads whether the photo currently open in the viewer is already in your library.
 *
 * The signal is the toolbar itself: Google Photos shows a "Save" button only for
 * a shared photo that you have not saved yet. We read the button names the same
 * way a screen reader does, so no obfuscated class name is involved.
 *
 * Everything here takes its DOM helpers as arguments, so the logic can be unit
 * tested with plain objects.
 */

/** Longest text we accept as a button name. Anything longer is a container, not a control. */
const MAX_CONTROL_NAME_LENGTH = 40;

/** Only controls in the top slice of the window count as toolbar controls. */
export const DEFAULT_TOOLBAR_TOP_FRACTION = 0.25;

const CONTROL_SELECTOR = 'button, [role="button"]';

/**
 * @typedef {import('./savedStateStore.js').SavedState} SavedState
 *
 * @typedef {object} ToolbarProbeDeps
 * @property {ParentNode} root
 * @property {readonly string[]} saveLabels
 * @property {readonly string[]} savedLabels
 * @property {(element: Element) => boolean} isVisible
 * @property {(element: Element) => boolean} isInToolbar
 * @property {() => boolean} [isBlocked]  True while something covers the viewer, such as a dialog.
 */

/**
 * Lowercases and collapses whitespace, so " Save  " and "save" compare equal.
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function normalizeLabel(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The name a screen reader would announce for this control.
 * @param {Element} element
 * @returns {string}
 */
export function readControlName(element) {
  const ariaLabel = normalizeLabel(element.getAttribute('aria-label'));
  if (ariaLabel !== '') return ariaLabel;

  const title = normalizeLabel(element.getAttribute('title'));
  if (title !== '') return title;

  const text = normalizeLabel(element.textContent);
  return text.length <= MAX_CONTROL_NAME_LENGTH ? text : '';
}

/**
 * Exact match, not "contains". "save" and "saved" mean opposite things, so a
 * loose match would report the wrong answer.
 * @param {string} name
 * @param {readonly string[]} labels
 * @returns {boolean}
 */
export function matchesAnyLabel(name, labels) {
  return name !== '' && labels.includes(name);
}

/**
 * @param {ToolbarProbeDeps} deps
 * @returns {string[]}
 */
export function collectToolbarControlNames({ root, isVisible, isInToolbar }) {
  /** @type {string[]} */
  const names = [];
  for (const control of root.querySelectorAll(CONTROL_SELECTOR)) {
    if (!isVisible(control) || !isInToolbar(control)) continue;
    const name = readControlName(control);
    if (name !== '') names.push(name);
  }
  return names;
}

/**
 * Turns the list of toolbar button names into a verdict.
 *
 * Returns `null` for "cannot tell yet". That happens while the toolbar is still
 * rendering, and it matters: an empty toolbar looks exactly like a saved photo,
 * so guessing here would mark unsaved photos as saved.
 *
 * @param {readonly string[]} toolbarControlNames
 * @param {readonly string[]} saveLabels
 * @param {readonly string[]} savedLabels
 * @returns {SavedState | null}
 */
export function classifySavedState(toolbarControlNames, saveLabels, savedLabels) {
  if (toolbarControlNames.length === 0) return null;
  if (toolbarControlNames.some((name) => matchesAnyLabel(name, saveLabels))) return 'unsaved';
  if (toolbarControlNames.some((name) => matchesAnyLabel(name, savedLabels))) return 'saved';
  // The toolbar is there and offers no way to save, so the photo is already yours.
  return 'saved';
}

/**
 * @param {ToolbarProbeDeps} deps
 * @returns {SavedState | null}
 */
export function probeSavedState(deps) {
  // A dialog such as "Edit date/time" carries its own Save button and hides the
  // viewer toolbar. Any reading taken while one is open is meaningless.
  if (deps.isBlocked?.() === true) return null;
  return classifySavedState(collectToolbarControlNames(deps), deps.saveLabels, deps.savedLabels);
}

/**
 * Builds the two DOM helpers the probe needs from a real window.
 * @param {Window} view
 * @param {number} toolbarTopFraction
 */
export function createDomProbeHelpers(view, toolbarTopFraction = DEFAULT_TOOLBAR_TOP_FRACTION) {
  return {
    /** @param {Element} element */
    isVisible(element) {
      const box = element.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return false;
      const style = view.getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    },

    /**
     * The toolbar sits across the top of the viewer. Limiting the search to that
     * strip keeps a "Save" button inside some other dialog from being counted.
     * @param {Element} element
     */
    isInToolbar(element) {
      return element.getBoundingClientRect().top < view.innerHeight * toolbarTopFraction;
    },
  };
}
