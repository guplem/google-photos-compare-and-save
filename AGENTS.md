# Google Photos Compare & Save

A Manifest V3 Chrome extension that changes the Google Photos website (`https://photos.google.com`). It does two things: it removes the slide between photos so you can compare them, and it marks the shared-album thumbnails that are not in your library yet. There is no build step, so the repository folder is the folder Chrome loads. Install, run, and troubleshooting details: `README.md`.

Delegate to these agents at the right moment (each agent's own description says what it does). They fall into two groups, by when they run.

**Before you implement (explore agents, launched as preparation):**

- **pattern-scout**: before implementing any non-trivial module, feature, or setting, and any time you ask "how do we do X here?". Returns real code examples with the rules distilled from them.
- **adr-checker** (consult mode): before implementing in an ADR-relevant area (the "Architecture Decision Records (ADRs)" section lists them). Returns the decisions the work must follow.

**After you implement, before you ship:**

- **docs-checker**: after a change that could affect documented content. Checks every documentation location (code comments, `README.md`, `AGENTS.md`, ADRs) against the code and fixes drift.
- **validate**: just before you create a PR or push. Runs the repo's checks the way CI does (format, types, tests) and reports pass or fail.
- **adr-checker** (maintain mode): after you introduce a new architectural pattern or change one an ADR records. Creates or updates the ADR.

Beyond these, spawn subagents freely: hand off research, code exploration, and parallel analysis so the files they read stay out of your own context. Give each subagent one task.

## Writing style

The people who read your output may read English as a second language and may be new to the area. Two layers apply. This section is the one home for both: no other file restates them.

**Layer 1 covers every piece of prose you write**: chat replies, PR and issue text, review comments, commit messages, and every document below. It follows Zinsser's four principles, which are simplicity, brevity, clarity, and humanity.

- **Short sentences, one idea each.** Use common words. Avoid idioms, slang, and cultural references.
- **Lead with the answer**, then only the detail that changes what the reader does. Cut filler and hedging. Do not use em dashes.
- **Assume a short attention span.** The reader usually skims to make a quick decision (which PR to review, which issue to pick), with little context and little time; put the single most important thing first, and make each part land even if they stop after the first line.
- **Gloss each jargon term, acronym, or tool/library name on first use** in one short clause, or pick a simpler word.
- **Explain a concept briefly before going deeper.** Do not assume a flow, tool, or pattern is already known.
- **Assume junior-level knowledge of the area.** Name the things you reference (files, commands, terms) instead of assuming the reader can guess.

**Layer 2 adds ASD-STE100 on top, for technical documents only**: `AGENTS.md`, ADRs, `README.md`, skills, subagents, and code comments. ASD-STE100 (Simplified Technical English) is a controlled-English standard from the aerospace industry. A maintenance manual must carry one reading and one only, and these documents have the same job.

- **Active voice only.** Name the actor: "the hook formats the file", not "the file gets formatted".
- **One meaning per word, and the same word for the same thing every time.** Never swap in a synonym for variety.
- **One instruction per sentence, and start the sentence with the verb.** Write "Run the migration", not "The migration should be run".
- **No `-ing` verb form as a noun or as a sentence opener.** Write "Use the skill to create a branch", not "Creating a branch is done with the skill".
- **About 20 words per sentence at most** (25 in descriptive text).
- **Leave out no word that guards the meaning.** Write "the file that you changed" when "the file you changed" could be misread.

Both layers cover prose only. Neither covers code identifiers or text you quote word for word.

## Commands

| Task                                   | Command                                                          | Notes                                                                            |
| -------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Install dependencies and the git hooks | `npm install`                                                    | The `prepare` script runs `lefthook install`. Run this once per clone.           |
| Run every check, the way CI runs it    | `npm run check`                                                  | Format check, then type check, then tests. This is the umbrella script CI calls. |
| Format the whole repo                  | `npm run format`                                                 | Prettier.                                                                        |
| Check the format only                  | `npm run format:check`                                           | Fix a failure with `npm run format`.                                             |
| Type check                             | `npm run typecheck`                                              | `tsc --noEmit` over the JSDoc types. Success prints nothing.                     |
| Run the tests                          | `npm test`                                                       | `node --test`. It finds `test/*.test.js` on its own.                             |
| Redraw the icons                       | `powershell -ExecutionPolicy Bypass -File scripts/makeIcons.ps1` | Windows only. Run it only when the artwork changes.                              |

There is no build and no code generation. To try the extension, load the repository folder unpacked in Chrome (`README.md` has the steps).

Whenever you need to confirm the code still passes, delegate to the **validate** agent (it runs the sequence above the way CI does).

## Architecture

The extension runs in three places. Know which one you are in before you write code.

| Place          | File                                                                 | Can use `chrome.*` | Can see page variables |
| -------------- | -------------------------------------------------------------------- | ------------------ | ---------------------- |
| MAIN world     | `src/instantSwap/mainWorldMotionPatch.js`                            | No                 | Yes                    |
| Isolated world | `src/bootstrap/isolatedWorldBootstrap.js` and all of `src/` below it | Yes                | No                     |
| Service worker | `src/background/serviceWorker.js`                                    | Yes                | No page at all         |

A content script listed in `manifest.json` cannot be an ES module. `isolatedWorldBootstrap.js` is a classic script whose only job is `import(chrome.runtime.getURL('src/contentEntry.js'))`. Every other file therefore uses plain `import` and stays unit testable under Node. Any new file under `src/` is reachable only because `web_accessible_resources` lists `src/*`. Keep that entry.

The two worlds do not use messages. The isolated world writes settings onto `<html>` as attributes, and the CSS and the MAIN world script read them. `adr/0004-two-content-script-worlds.md` records why.

| Attribute                          | Read by                   | Values                                                  |
| ---------------------------------- | ------------------------- | ------------------------------------------------------- |
| `data-gpcs-instant-swap`           | `instantSwapStyles.css`   | `transitions`, `transitions-and-animations`, or absent  |
| `data-gpcs-dim-saved`              | `savedBadgeStyles.css`    | `on` or absent                                          |
| `data-gpcs-main-world`             | `mainWorldMotionPatch.js` | JSON with `patchReducedMotion` and `clampWebAnimations` |
| `data-gpcs-state` (on a grid link) | `savedBadgeStyles.css`    | `saved`, `unsaved`, `unknown`                           |

The MAIN world script starts before the settings load, so it applies its own defaults until the attribute appears. Changing `patchReducedMotion` or `clampWebAnimations` needs a page reload. Say so in any UI that exposes them.

### File map

| File                                         | Holds                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `src/contentEntry.js`                        | Wiring only. Settings, routing, scan orchestration, storage writes.       |
| `src/googlePhotosPage.js`                    | URL parsing and the grid link selector. **All URL knowledge lives here.** |
| `src/settings/extensionSettings.js`          | Defaults and `normalizeSettings`.                                         |
| `src/savedState/savedStateStore.js`          | The per-album cache in `chrome.storage.local`.                            |
| `src/savedState/savedStateProbe.js`          | Reads the viewer toolbar and decides saved or unsaved.                    |
| `src/savedState/photoViewerNavigator.js`     | Moves the viewer to the next photo. **All DOM clicking lives here.**      |
| `src/savedState/albumSavedStateScanner.js`   | The scan loop. Pure logic, no DOM.                                        |
| `src/savedState/savedBadgeRenderer.js`       | Draws the badges on the grid.                                             |
| `src/controlPanel/controlPanelController.js` | The in-page panel.                                                        |
| `options/optionsPage.*`                      | The settings page.                                                        |

## Rules

- **Never match a Google class name.** Google Photos ships obfuscated class names (`QxNbxb`, `mTvPtb`) that change with every release. Match the URL, a link target (`a[href*="/photo/"]`), or an accessible name (`aria-label`, `title`, short `textContent`) instead. Use position on screen only to narrow a set already matched by name. See `adr/0005-semantic-dom-matching.md`.
- **Never click a control you cannot name.** A click target must match a known word first. When nothing matches, stop and report `stuck`. A scan that stops early is a bug report; a scan that clicks blind opened the "Edit date/time" dialog once and is a data-loss risk.
- **Keep DOM code out of the logic.** `albumSavedStateScanner.js` receives every browser action as a function, which is why its whole loop is unit tested with no browser. Put each fragile DOM call in a small adapter, keep the decision in a pure function, and test the pure function.
- **Treat "cannot tell yet" as its own answer.** `classifySavedState` returns `null` when the toolbar has no visible buttons. An empty toolbar and a saved photo look identical, so a guess marks unsaved photos as done and the user loses photos. Never collapse `null` into a state.
- **The two saved-state answers are not symmetrical.** Accept `unsaved` on the first clear reading, because a half-drawn toolbar cannot invent a Save button. Make `saved` hold for `confirmSavedMs` first, because it is the absence of that button. Do not replace this with one symmetrical timeout.
- **Shorten motion to 1ms, never to 0s.** A `transition-duration` of `0s` cancels the transition, so the browser never fires `transitionend`. Google Photos removes the outgoing photo on that event, so `0s` can leave the old photo stuck on screen. The same applies to the Web Animations clamp in the MAIN world.
- **Validate everything that comes out of storage.** `normalizeSettings` and `normalizeAlbumRecord` drop unknown keys and repair wrong values, because storage can hold data written by an older version. Extend those functions when you add a field, and add a test.
- **Use the two storage areas as `adr/0007-extension-storage-layout.md` sets them.** Settings go in `chrome.storage.sync`; scan results go in `chrome.storage.local`, one key per album. Never put scan results in `sync`: a large album exceeds the per-item quota.
- **Add a setting in all four places.** Whenever you add a setting, use the `add-setting` skill. A setting that misses one place resets itself with no error.

## Gotchas

- **The grid is virtualised.** Google Photos reuses the same `<a>` elements for different photos as you scroll. Two consequences. First, one pass of decoration is not enough: `savedBadgeRenderer` watches for changes and stamps each link with `data-gpcs-state` so a redraw is cheap. Second, **document order is not album order**: `querySelector('a[href*="/photo/"]')` returns whichever link was recycled last, not the first photo. `openFirstPhoto` scrolls the grid container to the top, waits for the redraw, then sorts the links by screen position.
- **`window.scrollTo` does not scroll the album grid.** Google Photos scrolls an inner container. Walk up from a grid link to the first ancestor whose `scrollHeight` exceeds its `clientHeight` and whose `overflow-y` is `auto` or `scroll`.
- **A cached photo skips the toolbar read, so the scan can outrun the page.** Google Photos loads a shared album in pages. Without `MIN_ADVANCE_GAP_MS` the scan steps through cached photos every few tens of milliseconds and arrives before the album has loaded that far, then reports a stall it caused itself. Keep the pause, and keep the advance backoff (`ADVANCE_ATTEMPT_TIMEOUTS_MS`) generous at the later attempts.
- **The next-photo chevron renders only while the pointer is over the photo.** A synthetic click never moves the real pointer, so `requestNextPhoto` dispatches a `mousemove` first. Without it the click fallback has nothing to click.
- **The viewer stays open on the last photo of an album.** The arrow key simply does nothing there, so the photo id neither changes nor clears. "Cannot advance" is therefore not proof of a stall, and it is not proof of the end either. Only a next-photo control that is present and **disabled** proves the album ended; `readNextControlState` reports that. Never treat an ambiguous stop as a finished scan, or the user trusts badges for photos the scan never read.
- **A dialog poisons a reading.** The "Edit date/time" dialog carries its own Save button. `probeSavedState` returns `null` whenever `isBlocked()` reports an open dialog, and `requestNextPhoto` presses Escape before it acts.
- **The content script starts before `<body>` exists.** `run_at` is `document_start`, which the MAIN world patch needs so it beats the app. Call `waitForBody()` before you touch `document.body`.
- **Google Photos rewrites the address bar with no event.** `watchLocation()` polls every 300ms. A `popstate` listener alone misses most navigations.
- **`node --test test/` fails on Node 24.** It treats the folder as a module. Run bare `node --test`, which is what `npm test` does.
- **Prettier uses `endOfLine: "auto"` on purpose.** This machine has `core.autocrlf=true`, so the working tree holds CRLF line endings. A pinned `endOfLine: "lf"` would fail the format check on every file while the content is correct.
- **The public Google Photos API cannot help.** Google restricted it in March 2025: an app now sees only the media it uploaded. There is no supported call for "is this photo in my library". Do not propose the API as a fix. `adr/0002-read-the-page-not-the-photos-api.md` holds the full reasoning, including why the internal `batchexecute` endpoint is not a better route.

## Test-Driven Development (mandatory)

Develop new behavior **test-first, red-green**: write a failing test that pins the behavior you want (**red**), make it pass with the smallest change (**green**), then clean up with the test as your safety net. A bug fix starts with a test that reproduces the bug.

What is testable here, and what is not:

- **Testable, and always test-first:** URL parsing (`googlePhotosPage.js`), settings validation (`extensionSettings.js`), the storage record shape (`savedStateStore.js`), the toolbar verdict (`classifySavedState`), and the whole scan loop (`albumSavedStateScanner.js`). The scan loop takes every browser action as an argument, so a test drives it with a fake viewer and a virtual clock and finishes at once.
- **Exempt, because a unit test would only re-state the code:** the thin DOM adapters (`photoViewerNavigator.js`, `savedBadgeRenderer.js`, `controlPanelController.js`, `createDomProbeHelpers`, `optionsPage.js`) and the MAIN world patch. Keep these thin: an adapter finds an element, clicks it, or writes an attribute, and it holds no decision.
- **The safety net for the exempt parts** is the type check (`npm run typecheck` reads every file, including the adapters) plus one manual run in Chrome. `adr/0006-testing-strategy.md` records this split.

When a bug appears in an exempt file, do not test the adapter. Move the decision that failed into a pure function, and test that.

The gate: CI runs the tests on every PR, and the repo ruleset "Requirements for merge" blocks merging until the `checks` check is green.

## Git Workflow

- Branch from `main`, PR back to `main`. Whenever you create a branch, use the `create-branch` skill.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`. Whenever you commit, use the `write-commit` skill.
- CI runs the repo's checks (the Commands table) on every PR; the ruleset "Requirements for merge" blocks merging until the `checks` check is green.
- **PRs merge automatically once the required `checks` check passes** (`.github/workflows/auto-merge.yml`); there is no human review gate, the tests are the review, which is what makes the TDD protocol non-negotiable.
- Three layers enforce quality, and they overlap on purpose: the Claude Code hooks in `.claude/settings.json` run while you edit, the lefthook `pre-commit` hook runs the format and type checks when anyone commits, and the CI required check is the merge gate.

## Documentation Organization

Each kind of knowledge has one home. Write a change in the home that matches it; never duplicate the same content across homes. What decides the home is **when the file loads** and **how deep it goes**, not its subject.

| Home                             | Loaded                           | Holds                                                                                                                                                                        |
| -------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                      | Every session                    | The map: architecture facts, conventions, gotchas, and the ADR index. Points to the homes below; does not repeat their depth. (`CLAUDE.md` is a one-line `@AGENTS.md` shim.) |
| `.claude/skills/<name>/SKILL.md` | On demand, when the task matches | One procedure: how to do X.                                                                                                                                                  |
| `adr/NNNN-*.md`                  | On demand, via adr-checker       | One architectural decision and its why.                                                                                                                                      |
| `README.md`                      | Read by humans                   | What the project is, install, use, options, troubleshooting.                                                                                                                 |

**All of these files are living: keep them true.** When you learn something that helps future agents, update the right file in the same session. When a file holds wrong or outdated information, fix it or remove it. This covers code comments too. After implementation, the **docs-checker** agent catches drift you missed.

**Rules:**

- ADRs are agent-only: never reference or list them in `README.md`.
- Number ADRs in sequence (`NNNN-kebab-title.md`) and never renumber an existing file. Index each one as a one-line row in the ADR table below, never a summary.
- Do not duplicate content between `README.md` and `AGENTS.md`; reference it instead.
- `CLAUDE.md` is a one-line `@AGENTS.md` shim; edit `AGENTS.md` instead.

## Architecture Decision Records (ADRs)

ADRs live in `adr/`. Each records one architectural decision or cross-cutting standard and why. **One ADR per pattern, kept alive:** when a pattern changes, update its ADR in place; create a new ADR only for a genuinely new pattern. Most changes need no ADR. Conventions: `adr/AGENTS.md` (auto-loads through its `adr/CLAUDE.md` shim when you work in `adr/`).

**Before implementing** in an area that may carry a decision, delegate to the **adr-checker** agent in consult mode. These areas usually carry decisions: the source of the saved-or-not signal; how the code finds and clicks elements in the Google Photos page; the split between the MAIN world and the isolated world, and the attribute channel between them; the extension storage layout; the testing strategy and the exempt files; the toolchain, the type system, and the absence of a build step.

**After implementing**, delegate to the **adr-checker** agent in maintain mode only if you introduced a new architectural pattern or changed one an ADR already records.

| ADR                                         | Topic                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `0001-agent-docs-structure.md`              | `AGENTS.md` map + Claude-Code-only skills, subagents, and settings               |
| `0002-read-the-page-not-the-photos-api.md`  | Saved-or-not comes from the viewer toolbar, not the Photos API or `batchexecute` |
| `0003-plain-javascript-with-jsdoc-types.md` | JSDoc types checked by `tsc`, so the repo folder is the extension folder         |
| `0004-two-content-script-worlds.md`         | MAIN world patch + isolated world logic, joined by `<html>` data attributes      |
| `0005-semantic-dom-matching.md`             | Match URLs, link targets, and accessible names; never obfuscated class names     |
| `0006-testing-strategy.md`                  | Pure logic is test-first; thin DOM adapters are exempt and covered by types      |
| `0007-extension-storage-layout.md`          | Settings in `sync`, scan results in `local`, one key per album                   |

## GitHub issues, PRs, and other artifacts

- **Always self-assign PRs** when you create them.
- **Always link PRs to issues** with `Closes #N` in the PR body, so the issue auto-closes on merge.
- **Always add the `waiting-for-human-check` label** when you create a GitHub issue, PR, or any other reviewable artifact. It means no human has verified the content yet; a human removes it after reviewing. The label marks state (unreviewed), not origin. In this repo the label does **not** block a merge: a green PR auto-merges with the label still on it.

If the repo has no `waiting-for-human-check` label, create it first:

```bash
gh label create "waiting-for-human-check" --description "No human has verified this yet -- direct AI output" --color "D93F0B"
```

Whenever you create a GitHub issue, use the `create-issue` skill. Whenever you implement one, use the `implement-issue` skill. Whenever you review a PR, use the `review-pr` skill (optional here, because no human review gate exists).

## Coding standards

- **Match existing patterns.** Before you write code, find similar implementations and follow their style, structure, and conventions (the **pattern-scout** agent does this).
- **Explicit type annotations** are mandatory for all parameters, return types, and non-trivial variables. This repo writes them as JSDoc comments, and `npm run typecheck` enforces them under `strict`.
- **Comment the _why_, never the _what_.** A comment must carry what the code cannot: a non-obvious constraint, an intentional divergence, a trap a future reader would reintroduce. Do not document self-explanatory names or signatures, and match the comment density of the surrounding file.

## Refactoring safety

Whenever you rename or refactor a symbol, use the `rename-symbol` skill.

## Debugging

Whenever a fix attempt fails or a bug needs root-causing, use the `debug` skill.

## Writing prompts for agents and rules

Whenever you author or edit an AI-facing file (`AGENTS.md`, skills under `.claude/skills/`, subagents under `.claude/agents/`, prompts for agents you spawn), use the `write-ai-instructions` skill.

## Self-updating rules

These instruction files are living, and keeping them current is part of the work. Persist a rule right away (in the narrowest scope that fits) instead of applying it only this session when you discover something **extremely hard to find, deeply non-obvious, and time-saving for future sessions**, hit a pattern that **diverges from what an AI would write by default**, when the user says **"every time" / "always" / "never"**, or when **feedback on your own work reveals a standard you should have followed** (a PR review comment, a user correction). Persist it in these shared, committed files, never in personal memory or the global config, so the whole team gets the lesson. For where to write it, use the `write-ai-instructions` skill.
