# Match the Google Photos page by meaning, and never click an unnamed control

## Context

This extension changes a page it does not own and cannot version-pin. Google Photos ships Closure-compiled markup: class names such as `QxNbxb` and `mTvPtb` are generated per build and change with no notice. A selector built on one is a time bomb that fails silently after a Google release.

Two failure modes matter, and they are not equally bad. A **read** that stops working shows wrong badges, which the user notices and can report. A **click** that lands on the wrong element takes an action in the user's own library. That already happened once: an early fallback clicked whichever button sat near the right edge of the window when the arrow key did not advance, and at the end of every album it hit the date row of the info sidebar and opened the "Edit date/time" dialog.

## Decision

**Match by meaning, in this order of preference.**

1. The URL: `/album/`, `/share/`, `/photo/`. `googlePhotosPage.js` is the only home for URL knowledge.
2. A link target: `a[href*="/photo/"]` finds every grid thumbnail.
3. An accessible name: `aria-label`, then `title`, then a short `textContent`. This is the name a screen reader announces, so Google must keep it correct.
4. Position on screen, **only to narrow a set already matched by name**, never on its own.

Never match a class name. If a change seems to need one, the design is wrong; find another signal.

**Never click a control you cannot name.** A click target must match a known word first. `photoViewerNavigator.js` is the only file that clicks, and its next-photo fallback requires both a name that contains a known "next" word and a position on the right of the window. When nothing matches, the scan stops and reports `stuck`. A scan that stops early is a bug report; a scan that clicks blind is a data-loss risk.

Names are language-dependent, so the save labels are a user setting and the next-photo words are a list in the navigator. The control panel's **Copy diagnostics** button reports the names actually found on the page, which is what repairs either list.

## Consequences

**Positive:**

- A Google redesign that renames a class changes nothing. Only a renamed button breaks the extension, and a user fixes that on the options page.
- The blast radius of a broken selector is a stopped scan, never a wrong action on the user's library.

**Trade-offs and follow-up:**

- The extension cannot work in a language whose button names are in neither list until someone adds them. The diagnostics report exists for exactly this.
- Reading accessible names means walking every `button, [role="button"]` in the document on each probe. The visible-and-in-the-toolbar filters keep that cheap enough at the polling rate the scanner uses.
- The next-photo word list lives in code, not in settings. Move it to settings if users report more languages than the list covers.
