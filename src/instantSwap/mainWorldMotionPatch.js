/**
 * Runs in the page's own JavaScript world (MAIN), at document_start.
 *
 * Google Photos can animate the swap between photos in two ways that a plain
 * stylesheet cannot stop:
 *   1. It asks the browser `matchMedia('(prefers-reduced-motion: reduce)')` and
 *      picks an animation length from the answer.
 *   2. It drives the slide with the Web Animations API (`element.animate()`),
 *      which ignores CSS `transition-duration` overrides.
 *
 * This file patches both. It cannot use `chrome.*` APIs, because the MAIN world
 * has no extension APIs. The isolated content script publishes the current
 * settings on `<html data-gpcs-main-world="...">` and this file reads that
 * attribute lazily, on every call.
 *
 * NOTE: this script starts before the settings are read from storage. Until the
 * attribute appears, DEFAULTS below apply. Changing these two settings
 * therefore needs a page reload to take full effect.
 */
(() => {
  'use strict';

  const SETTINGS_ATTRIBUTE = 'data-gpcs-main-world';

  /** Applied until the isolated world publishes the real settings. */
  const DEFAULTS = { patchReducedMotion: true, clampWebAnimations: false };

  /** Longest animation we allow, in milliseconds. */
  const CLAMPED_DURATION_MS = 1;

  /** @type {{ raw: string, value: { patchReducedMotion: boolean, clampWebAnimations: boolean } }} */
  let settingsCache = { raw: '', value: DEFAULTS };

  /**
   * Reads the settings the isolated world published on the <html> element.
   * Parses at most once per distinct attribute value, because this runs inside
   * hot paths such as `element.animate()`.
   * @returns {{ patchReducedMotion: boolean, clampWebAnimations: boolean }}
   */
  function readSettings() {
    const raw = document.documentElement.getAttribute(SETTINGS_ATTRIBUTE);
    if (raw === null) return DEFAULTS;
    if (raw === settingsCache.raw) return settingsCache.value;
    try {
      const parsed = JSON.parse(raw);
      const value = {
        patchReducedMotion: parsed.patchReducedMotion !== false,
        clampWebAnimations: parsed.clampWebAnimations === true,
      };
      settingsCache = { raw, value };
      return value;
    } catch {
      return DEFAULTS;
    }
  }

  /**
   * Makes the page believe the viewer asked the operating system for less
   * motion. Only answers about `prefers-reduced-motion` change; every other
   * media query passes through untouched.
   */
  function patchMatchMedia() {
    const nativeMatchMedia = window.matchMedia.bind(window);

    /**
     * @param {string} query
     * @returns {MediaQueryList}
     */
    window.matchMedia = function matchMedia(query) {
      const list = nativeMatchMedia(query);
      if (typeof query !== 'string' || !/prefers-reduced-motion/i.test(query)) return list;

      // "(prefers-reduced-motion: reduce)" must answer true.
      // "(prefers-reduced-motion: no-preference)" must answer false.
      const answer = !/no-preference/i.test(query);

      return new Proxy(list, {
        get(target, property) {
          if (property === 'matches' && readSettings().patchReducedMotion) return answer;
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
  }

  /**
   * Shortens a Web Animations timing argument to almost nothing.
   * @param {number | KeyframeAnimationOptions | undefined} options
   * @returns {number | KeyframeAnimationOptions | undefined}
   */
  function clampTiming(options) {
    if (typeof options === 'number') return Math.min(options, CLAMPED_DURATION_MS);
    if (options === null || typeof options !== 'object') return options;

    const clamped = { ...options };
    if (typeof clamped.duration === 'number') {
      clamped.duration = Math.min(clamped.duration, CLAMPED_DURATION_MS);
    }
    if (typeof clamped.delay === 'number') clamped.delay = 0;
    if (typeof clamped.endDelay === 'number') clamped.endDelay = 0;
    return clamped;
  }

  /**
   * Shortens every animation the page starts through `element.animate()`.
   * The animation still runs and still fires its `finish` event, so page code
   * that waits for the end keeps working. It just ends in about one
   * millisecond instead of a few hundred.
   */
  function patchWebAnimations() {
    if (typeof Element.prototype.animate !== 'function') return;
    const nativeAnimate = Element.prototype.animate;

    /**
     * @this {Element}
     * @param {Keyframe[] | PropertyIndexedKeyframes | null} keyframes
     * @param {number | KeyframeAnimationOptions} [options]
     * @returns {Animation}
     */
    Element.prototype.animate = function animate(keyframes, options) {
      const timing = readSettings().clampWebAnimations ? clampTiming(options) : options;
      return nativeAnimate.call(this, keyframes, timing);
    };
  }

  patchMatchMedia();
  patchWebAnimations();
})();
