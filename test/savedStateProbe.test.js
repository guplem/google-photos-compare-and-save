import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySavedState,
  collectToolbarControlNames,
  matchesAnyLabel,
  normalizeLabel,
  readControlName,
} from '../src/savedState/savedStateProbe.js';

const SAVE_LABELS = ['save', 'add to library'];
const SAVED_LABELS = ['saved'];

/**
 * A stand-in for a DOM element, with only the two members the probe reads.
 * @param {{ ariaLabel?: string, title?: string, text?: string }} [parts]
 * @returns {Element}
 */
function fakeControl({ ariaLabel, title, text } = {}) {
  return /** @type {any} */ ({
    getAttribute(/** @type {string} */ name) {
      if (name === 'aria-label') return ariaLabel ?? null;
      if (name === 'title') return title ?? null;
      return null;
    },
    textContent: text ?? '',
  });
}

/**
 * @param {Element[]} controls
 * @returns {ParentNode}
 */
function fakeRoot(controls) {
  return /** @type {any} */ ({ querySelectorAll: () => controls });
}

test('normalizes surrounding and repeated whitespace', () => {
  assert.equal(normalizeLabel('  Save  '), 'save');
  assert.equal(normalizeLabel('Add   to\nlibrary'), 'add to library');
  assert.equal(normalizeLabel(null), '');
});

test('prefers the aria-label, then the title, then the text', () => {
  assert.equal(readControlName(fakeControl({ ariaLabel: 'Save', text: 'ignored' })), 'save');
  assert.equal(readControlName(fakeControl({ title: 'Save', text: 'ignored' })), 'save');
  assert.equal(readControlName(fakeControl({ text: 'Save' })), 'save');
});

test('ignores long text, because that is a container and not a button', () => {
  const longText = 'a'.repeat(80);
  assert.equal(readControlName(fakeControl({ text: longText })), '');
});

test('matches labels exactly, so "saved" never counts as "save"', () => {
  assert.equal(matchesAnyLabel('save', SAVE_LABELS), true);
  assert.equal(matchesAnyLabel('saved', SAVE_LABELS), false);
  assert.equal(matchesAnyLabel('', SAVE_LABELS), false);
});

test('a Save button means the photo is not saved', () => {
  assert.equal(classifySavedState(['save', 'share', 'info'], SAVE_LABELS, SAVED_LABELS), 'unsaved');
});

test('a toolbar without a Save button means the photo is already saved', () => {
  assert.equal(classifySavedState(['share', 'info'], SAVE_LABELS, SAVED_LABELS), 'saved');
});

test('an explicit Saved button also means saved', () => {
  assert.equal(classifySavedState(['saved', 'share'], SAVE_LABELS, SAVED_LABELS), 'saved');
});

test('an empty toolbar means "cannot tell yet", never "saved"', () => {
  // This is the important one: the toolbar renders a moment after the photo, and
  // guessing "saved" here would silently mark unsaved photos as done.
  assert.equal(classifySavedState([], SAVE_LABELS, SAVED_LABELS), null);
});

test('collects only the visible controls that sit in the toolbar', () => {
  const save = fakeControl({ ariaLabel: 'Save' });
  const hidden = fakeControl({ ariaLabel: 'Hidden' });
  const belowToolbar = fakeControl({ ariaLabel: 'Delete' });

  const names = collectToolbarControlNames({
    root: fakeRoot([save, hidden, belowToolbar]),
    saveLabels: SAVE_LABELS,
    savedLabels: SAVED_LABELS,
    isVisible: (element) => element !== hidden,
    isInToolbar: (element) => element !== belowToolbar,
  });

  assert.deepEqual(names, ['save']);
});
