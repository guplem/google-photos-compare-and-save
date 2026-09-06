/**
 * Background service worker. It exists only so that the toolbar button and the
 * panel's "Options" button can open the options page: a content script is not
 * allowed to open an extension page on its own.
 */

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'open-options') chrome.runtime.openOptionsPage();
});
