import test from 'node:test';
import assert from 'node:assert/strict';

import { isAlbumContext, readAlbumKey, readGooglePhotosLocation, readPhotoKey } from '../src/googlePhotosPage.js';

test('reads the photo id from a photo URL', () => {
  assert.equal(readPhotoKey('https://photos.google.com/photo/AF1QipABC123'), 'AF1QipABC123');
  assert.equal(readPhotoKey('https://photos.google.com/album/XYZ/photo/AF1QipABC123'), 'AF1QipABC123');
  assert.equal(readPhotoKey('https://photos.google.com/share/S1/photo/P1?key=k'), 'P1');
});

test('returns null when the URL has no photo', () => {
  assert.equal(readPhotoKey('https://photos.google.com/album/XYZ'), null);
  assert.equal(readPhotoKey('https://photos.google.com/'), null);
});

test('reads the album id from both personal and shared albums', () => {
  assert.equal(readAlbumKey('https://photos.google.com/album/XYZ'), 'XYZ');
  assert.equal(readAlbumKey('https://photos.google.com/share/S1?key=k'), 'S1');
});

test('handles the profile prefix of a second Google account', () => {
  const location = readGooglePhotosLocation('https://photos.google.com/u/1/album/XYZ/photo/P1');
  assert.deepEqual(location, { kind: 'photo-in-album', albumKey: 'XYZ', photoKey: 'P1' });
});

test('classifies every page kind', () => {
  assert.equal(readGooglePhotosLocation('https://photos.google.com/album/XYZ').kind, 'album');
  assert.equal(readGooglePhotosLocation('https://photos.google.com/share/S1?key=k').kind, 'album');
  assert.equal(readGooglePhotosLocation('https://photos.google.com/album/XYZ/photo/P1').kind, 'photo-in-album');
  assert.equal(readGooglePhotosLocation('https://photos.google.com/photo/P1').kind, 'photo');
  assert.equal(readGooglePhotosLocation('https://photos.google.com/search/dogs').kind, 'other');
});

test('only album pages get the panel and the badges', () => {
  assert.equal(isAlbumContext(readGooglePhotosLocation('https://photos.google.com/album/XYZ')), true);
  assert.equal(isAlbumContext(readGooglePhotosLocation('https://photos.google.com/share/S1/photo/P1')), true);
  assert.equal(isAlbumContext(readGooglePhotosLocation('https://photos.google.com/photo/P1')), false);
  assert.equal(isAlbumContext(readGooglePhotosLocation('https://photos.google.com/')), false);
});
