# Split the content script across the MAIN and isolated worlds, joined by data attributes

## Context

Chrome runs a content script in one of two JavaScript worlds. The **isolated** world can call `chrome.*` extension APIs but cannot see the page's own variables or prototypes. The **MAIN** world sees the page's variables and prototypes but has no extension APIs.

The extension needs both. The badges need `chrome.storage`, so they must run isolated. The instant swap may need to patch what the page itself calls: `window.matchMedia`, so the page believes the viewer asked for less motion, and `Element.prototype.animate`, so a JavaScript-driven slide is shortened. A patch works only from the MAIN world, and it must run at `document_start`, before the app reads either one.

So two scripts must run in different worlds, and the MAIN one needs settings that only the isolated one can read.

## Decision

Ship two content scripts, both at `run_at: document_start`.

- `src/instantSwap/mainWorldMotionPatch.js` runs in the MAIN world. It is a self-contained classic script and uses no `chrome.*` API.
- `src/bootstrap/isolatedWorldBootstrap.js` runs in the isolated world. A manifest content script cannot be an ES module, so this classic script does one thing: `import(chrome.runtime.getURL('src/contentEntry.js'))`. Every other file in `src/` is then a real ES module, which is what lets Node unit test them.

The two worlds exchange settings through **data attributes on `<html>`**, not through `window.postMessage`. The isolated world writes them in `publishSettings`; the stylesheets and the MAIN world script read them. The root `AGENTS.md` lists every attribute and its reader.

The MAIN world script reads its attribute lazily, on each call, and applies its own defaults until the attribute appears. It starts before `chrome.storage` resolves, so the first moments of a page load always use those defaults.

**Rejected alternative:** `window.postMessage` between the worlds. It is asynchronous, so the MAIN patch would still miss the earliest `matchMedia` calls, and it puts extension messages on a channel the page can read and forge. An attribute is synchronous to read and needs no listener.

**Rejected alternative:** put everything in the MAIN world and give up `chrome.storage`. Settings would then live in `localStorage` on the page's origin, which the options page cannot reach.

## Consequences

**Positive:**

- The CSS reads the same attribute the script does, so one write in `publishSettings` drives both.
- The isolated half stays a normal ES module tree, so Node unit tests it with no browser.

**Trade-offs and follow-up:**

- `patchReducedMotion` and `clampWebAnimations` need a page reload to take full effect, because the page may already hold a patched or unpatched `MediaQueryList`. Any UI that exposes them must say so.
- The page can read and overwrite the attributes. Nothing secret goes in them, and the worst case is that the instant swap stops.
- The MAIN world patch cannot change what a CSS `@media (prefers-reduced-motion)` block matches. Only a real browser or system setting does that.
