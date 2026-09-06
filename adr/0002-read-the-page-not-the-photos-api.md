# Read the viewer toolbar to decide whether a photo is saved

## Context

In a shared album, Google Photos shows a **Save** button only for a photo that is not yet in your own library. A person must open each photo to find out which ones are missing. The extension exists to answer that question for a whole album at once, so it needs a machine-readable source for the same fact.

Three sources exist, and only one is usable.

1. **The public Google Photos API.** Google restricted it in March 2025. An application now sees only the media that it uploaded itself. No supported call answers "is this photo in my library". This source is closed.
2. **The internal endpoint the web app itself calls** (`batchexecute`). The app clearly knows the answer, because it decides whether to draw the Save button. The payload is an unnamed nested array with no field names, it changes with no notice, and a reader must replay the page's own credentials to fetch it.
3. **The viewer toolbar in the rendered page.** The presence of the Save button is the same signal a person uses.

## Decision

Read the viewer toolbar. `savedStateProbe.js` collects the accessible names of the visible toolbar controls, matches them against a configurable label list, and returns `unsaved`, `saved`, or `null` for "cannot tell yet". `albumSavedStateScanner.js` walks the album one photo at a time and records each answer, and `savedStateStore.js` caches the answers so the walk is paid once per album.

Two consequences of this source shape the design and must not be simplified away.

- **`null` is a real answer.** An empty toolbar and a saved photo look identical, so a guess would mark unsaved photos as done and the user would lose photos.
- **The two answers are not symmetrical.** A visible Save button is positive evidence, so `unsaved` is accepted on the first clear reading, with no settling delay. `saved` is the absence of that button, which is also what a half-drawn toolbar looks like, so it waits out `minDwellMs` and then must hold for `confirmSavedMs`. This is both the fast path and the safe path, because a stale toolbar can only mislead in the harmless direction: a saved photo badged unsaved costs one re-save that Google Photos deduplicates.

**Rejected alternative:** parse the `batchexecute` responses. It would remove the per-photo walk and make a scan almost instant, but it breaks silently whenever Google reorders an array, it needs the page's credentials, and a wrong index yields a plausible wrong answer instead of an error. The toolbar breaks loudly and is fixed by editing a label list.

**Rejected alternative:** skip the feature and tell the user to select every photo and press Save, because Google deduplicates identical files. That solves the underlying chore but not the stated need, which is to see at a glance which photos are missing.

## Consequences

**Positive:**

- The signal survives a Google redesign as long as a button named "Save" exists. A rename is fixed on the options page with no code change.
- No credential replay and no undocumented endpoint, so the extension needs no network permission at all.

**Trade-offs and follow-up:**

- A scan must open every photo, so it costs roughly a tenth of a second per unsaved photo and about half a second per saved one, plus the bandwidth of loading each photo. Almost every photo in an album worth managing is unsaved, so the fast path sets the pace.
- The label list is language-dependent. The panel's **Copy diagnostics** button reports the names actually found, so a user in any language can repair the list.
- If Google ever stops showing a Save button for an unsaved shared photo, this approach has no fallback and the feature ends.
