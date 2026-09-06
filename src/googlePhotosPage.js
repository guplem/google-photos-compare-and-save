/**
 * Everything this extension knows about the shape of Google Photos URLs and
 * about the few DOM elements it needs to find.
 *
 * Google Photos ships obfuscated class names that change without warning, so
 * nothing here matches a class name. We only use URLs, link targets, and
 * accessible names, which are stable because the site needs them to work.
 */

/** Matches the photo id in ".../photo/AF1QipXXXX". */
const PHOTO_KEY_PATTERN = /\/photo\/([^/?#]+)/;

/** Matches the album id in ".../album/XXXX" or the share id in ".../share/XXXX". */
const ALBUM_KEY_PATTERN = /\/(?:album|share)\/([^/?#]+)/;

/** Every thumbnail in a grid is a link to a photo page. */
export const GRID_PHOTO_LINK_SELECTOR = 'a[href*="/photo/"]';

/**
 * @typedef {'album' | 'photo-in-album' | 'photo' | 'other'} GooglePhotosPageKind
 *
 * @typedef {object} GooglePhotosLocation
 * @property {GooglePhotosPageKind} kind
 * @property {string | null} albumKey  Album or shared-album id, when the URL has one.
 * @property {string | null} photoKey  Photo id, when the photo viewer is open.
 */

/**
 * @param {string} url
 * @returns {string | null}
 */
export function readPhotoKey(url) {
  const match = PHOTO_KEY_PATTERN.exec(url);
  return match?.[1] ?? null;
}

/**
 * @param {string} url
 * @returns {string | null}
 */
export function readAlbumKey(url) {
  const match = ALBUM_KEY_PATTERN.exec(url);
  return match?.[1] ?? null;
}

/**
 * Splits a Google Photos URL into the parts this extension cares about.
 * Works for personal albums (/album/), shared albums (/share/), and for
 * accounts with a profile prefix such as /u/1/.
 * @param {string} url
 * @returns {GooglePhotosLocation}
 */
export function readGooglePhotosLocation(url) {
  const albumKey = readAlbumKey(url);
  const photoKey = readPhotoKey(url);

  if (albumKey !== null && photoKey !== null) return { kind: 'photo-in-album', albumKey, photoKey };
  if (albumKey !== null) return { kind: 'album', albumKey, photoKey: null };
  if (photoKey !== null) return { kind: 'photo', albumKey: null, photoKey };
  return { kind: 'other', albumKey: null, photoKey: null };
}

/**
 * True when the page belongs to one album, either its grid or one of its photos.
 * The control panel and the badges only appear on those pages.
 * @param {GooglePhotosLocation} location
 * @returns {boolean}
 */
export function isAlbumContext(location) {
  return location.kind === 'album' || location.kind === 'photo-in-album';
}

/**
 * Reads the photo id a grid thumbnail points at.
 * @param {HTMLAnchorElement} link
 * @returns {string | null}
 */
export function readPhotoKeyFromLink(link) {
  // `link.href` is always absolute, even when the attribute is "./photo/...".
  return readPhotoKey(link.href);
}

/**
 * @param {ParentNode} root
 * @returns {HTMLAnchorElement[]}
 */
export function findGridPhotoLinks(root) {
  return Array.from(root.querySelectorAll(GRID_PHOTO_LINK_SELECTOR));
}
