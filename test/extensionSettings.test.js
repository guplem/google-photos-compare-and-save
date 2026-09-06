import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings/extensionSettings.js';

test('an empty store gives the defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings('garbage'), DEFAULT_SETTINGS);
});

test('keeps valid values and repairs the invalid ones', () => {
  const settings = normalizeSettings({
    instantSwapEnabled: false,
    instantSwapLevel: 'something-else',
    scanConfirmSavedMs: 'fast',
    savedBadgesEnabled: true,
  });

  assert.equal(settings.instantSwapEnabled, false);
  assert.equal(settings.instantSwapLevel, DEFAULT_SETTINGS.instantSwapLevel);
  assert.equal(settings.scanConfirmSavedMs, DEFAULT_SETTINGS.scanConfirmSavedMs);
});

test('clamps the delays to a workable range', () => {
  assert.equal(normalizeSettings({ scanConfirmSavedMs: 1 }).scanConfirmSavedMs, 50);
  assert.equal(normalizeSettings({ scanConfirmSavedMs: 999999 }).scanConfirmSavedMs, 5000);
  assert.equal(normalizeSettings({ scanPollMs: 1 }).scanPollMs, 20);
  assert.equal(normalizeSettings({ scanTimeoutMs: 10 }).scanTimeoutMs, 500);
});

test('lowercases and trims the button names', () => {
  const settings = normalizeSettings({ saveLabels: ['  Save ', 'GUARDAR', '', 42] });
  assert.deepEqual(settings.saveLabels, ['save', 'guardar']);
});

test('an empty label list falls back to the defaults, so the probe never goes blind', () => {
  assert.deepEqual(normalizeSettings({ saveLabels: [] }).saveLabels, DEFAULT_SETTINGS.saveLabels);
});

test('drops keys we do not know, so a renamed setting cannot linger', () => {
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, scanSettleMs: 350 });
  assert.deepEqual(Object.keys(settings).sort(), Object.keys(DEFAULT_SETTINGS).sort());
});
