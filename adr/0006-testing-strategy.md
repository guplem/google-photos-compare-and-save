# Test the logic test-first; leave the thin DOM adapters to the type check

## Context

The repo mandates red-green TDD. A Chrome extension resists it in one specific place: the code that reads and clicks a live Google Photos page. That code cannot be honestly unit tested. A test would have to build a fake DOM that this repo itself invented, so it would only assert that the adapter calls the methods the test told it to call. It would pass while the real page had changed, which is the one failure that actually happens here.

The rest of the extension is different. The scan loop, the toolbar verdict, the URL parsing, the settings validation, and the storage record shape are all decisions. They deserve tests, and they are also where a bug loses a user's photos.

There is also a speed problem. The scan waits hundreds of milliseconds per photo by design. A test suite that really waited would take minutes.

## Decision

**Split the code so the decisions are testable, then test all of them test-first.**

- `albumSavedStateScanner.js` holds the scan loop and **contains no DOM code at all**. Every browser action arrives as a function: `readCurrentPhotoKey`, `requestNextPhoto`, `probe`, `wait`, `now`. A test passes a fake viewer with a virtual clock, where `wait` only adds to a counter, so the whole suite finishes in milliseconds.
- `savedStateProbe.js` splits the same way: `collectToolbarControlNames` touches the DOM, `classifySavedState` decides, and the tests cover the decision.
- `googlePhotosPage.js`, `extensionSettings.js`, and `savedStateStore.js` are pure and fully tested. The store takes a storage area as an argument, so a test passes an in-memory object.

**Exempt from unit tests:** `photoViewerNavigator.js`, `savedBadgeRenderer.js`, `controlPanelController.js`, `createDomProbeHelpers`, `optionsPage.js`, and `mainWorldMotionPatch.js`. Keep them thin. An adapter finds an element, clicks it, or writes an attribute. It holds no decision. When a bug appears in one of them, move the decision that failed into a pure function and test that, rather than test the adapter.

**The safety net for the exempt files** is two things. `npm run typecheck` reads every file in the repo under `strict`, so a wrong property name or a null-handling mistake fails the build. One manual run in Chrome covers the rest, because judging the instant swap needs eyes anyway.

Two tests exist specifically to pin the failures that lose photos, and neither may be deleted:

- `an empty toolbar means "cannot tell yet", never "saved"`.
- `a Save button that draws late is still seen, never reported as saved`.

**Rejected alternative:** a headless browser (Puppeteer or Playwright) driving the real Google Photos. It would need a real Google account with real shared albums, it would break whenever Google changed the page, and it cannot run in CI without credentials. The value it adds is exactly the value the manual Chrome run already gives.

**Rejected alternative:** jsdom tests for the adapters. jsdom would let the tests run, but the fake DOM would be this repo's own guess at Google's markup, so a green test would prove nothing about the real page.

## Consequences

**Positive:**

- The suite runs in well under a second, so the pre-commit hook and CI stay fast.
- The dependency-injected scan loop makes each dangerous edge case (a late Save button, a toolbar that never draws, an album that loops) a cheap and deterministic test.

**Trade-offs and follow-up:**

- The files most likely to break are the ones with no tests. That is deliberate: the type check and the diagnostics report cover them instead.
- The exemption only holds while the adapters stay thin. A decision that creeps into an adapter is a defect, and the fix is to move it out, not to widen the exemption.
- There is no merge gate for "it still works in Chrome". The PRs here auto-merge on a green check, so any change to an exempt file needs a manual load before it is trusted.
