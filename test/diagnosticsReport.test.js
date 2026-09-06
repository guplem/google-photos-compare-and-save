import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDiagnosticsReport, redactPhotoUrl, summarizeToolbarSamples } from '../src/diagnosticsReport.js';

test('removes the album and photo ids from the url', () => {
  assert.equal(
    redactPhotoUrl('https://photos.google.com/share/AF1QipSECRET/photo/AF1QipALSOSECRET?key=abc#x'),
    'https://photos.google.com/share/<id>/photo/<id>',
  );
  assert.equal(redactPhotoUrl('https://photos.google.com/u/1/album/XYZ'), 'https://photos.google.com/u/1/album/<id>');
});

test('reports that the toolbar disappears while the pointer stays still', () => {
  // This is the failure the report exists to expose: the viewer chrome fades
  // out, so the probe sees nothing and calls the photo unreadable.
  const summary = summarizeToolbarSamples([['save', 'share'], ['save', 'share'], []]);

  assert.equal(summary.disappearsWhenIdle, true);
  assert.deepEqual(summary.controlCounts, [2, 2, 0]);
});

test('does not claim the toolbar disappears when it stays put', () => {
  const summary = summarizeToolbarSamples([
    ['save', 'share'],
    ['save', 'share'],
    ['save', 'share'],
  ]);

  assert.equal(summary.disappearsWhenIdle, false);
});

test('does not claim the toolbar disappears when it was never there', () => {
  // Never visible is a different failure from fading out, and the fixes differ.
  const summary = summarizeToolbarSamples([[], [], []]);

  assert.equal(summary.disappearsWhenIdle, false);
  assert.equal(summary.neverVisible, true);
});

test('carries the outcome of the last scan, so a stall can be read after the fact', () => {
  const report = buildDiagnosticsReport({
    extensionVersion: '0.1.0',
    url: 'https://photos.google.com/share/S1/photo/P1?key=k',
    pageLocation: { kind: 'photo-in-album', albumKey: 'S1', photoKey: 'P1' },
    gridPhotoLinks: 30,
    toolbarSamples: [['save'], []],
    probeResult: 'unsaved',
    dialogOpen: false,
    nextControlState: 'missing',
    viewport: { width: 1920, height: 1080 },
    saveLabels: ['save'],
    savedLabels: ['saved'],
    cachedPhotos: 188,
    lastScan: { reason: 'stuck', scanned: 52, saved: 1, unsaved: 39, unknown: 12, nextControlState: 'missing' },
  });

  // `lastScan` is either an outcome or a sentence for a human reading the JSON.
  const lastScan = /** @type {import('../src/savedState/albumSavedStateScanner.js').ScanOutcome} */ (report.lastScan);
  assert.equal(report.url, 'https://photos.google.com/share/<id>/photo/<id>');
  assert.equal(lastScan.reason, 'stuck');
  assert.equal(lastScan.unknown, 12);
  assert.equal(report.toolbar.disappearsWhenIdle, true);
  assert.equal(report.nextControlState, 'missing');
});

test('says plainly when no scan has run yet', () => {
  const report = buildDiagnosticsReport({
    extensionVersion: '0.1.0',
    url: 'https://photos.google.com/share/S1',
    pageLocation: { kind: 'album', albumKey: 'S1', photoKey: null },
    gridPhotoLinks: 30,
    toolbarSamples: [[]],
    probeResult: null,
    dialogOpen: false,
    nextControlState: 'missing',
    viewport: { width: 1920, height: 1080 },
    saveLabels: ['save'],
    savedLabels: ['saved'],
    cachedPhotos: 0,
    lastScan: null,
  });

  assert.equal(report.lastScan, 'no scan has run in this tab');
});

test('never reports an album id or a photo id', () => {
  const report = buildDiagnosticsReport({
    extensionVersion: '0.1.0',
    url: 'https://photos.google.com/share/SECRETALBUM/photo/SECRETPHOTO?key=SECRETKEY',
    pageLocation: { kind: 'photo-in-album', albumKey: 'SECRETALBUM', photoKey: 'SECRETPHOTO' },
    gridPhotoLinks: 30,
    toolbarSamples: [['save']],
    probeResult: 'unsaved',
    dialogOpen: false,
    nextControlState: 'enabled',
    viewport: { width: 1920, height: 1080 },
    saveLabels: ['save'],
    savedLabels: ['saved'],
    cachedPhotos: 1,
    lastScan: null,
  });

  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes('SECRETALBUM'), 'the album id must never reach the report');
  assert.ok(!serialized.includes('SECRETPHOTO'), 'the photo id must never reach the report');
  assert.ok(!serialized.includes('SECRETKEY'), 'the share key must never reach the report');
  assert.equal(report.hasAlbumKey, true);
  assert.equal(report.hasPhotoKey, true);
});
