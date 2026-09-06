/**
 * Classic script, because a content script listed in the manifest cannot be an
 * ES module. Its only job is to load the real entry point as a module, which
 * lets every other file in `src/` use plain `import` and stay unit testable.
 */
(async () => {
  try {
    const entry = await import(chrome.runtime.getURL('src/contentEntry.js'));
    await entry.start();
  } catch (error) {
    console.error('[Compare & Save] failed to start', error);
  }
})();
