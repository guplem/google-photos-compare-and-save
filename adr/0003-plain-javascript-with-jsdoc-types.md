# Plain JavaScript with JSDoc types, checked by tsc, and no build step

## Context

The user's standard requires explicit types on every parameter, return type, and non-trivial variable. TypeScript is the obvious way to get them, but it needs a compiler, so the folder a developer edits stops being the folder Chrome loads.

That gap matters more than usual here. The whole development loop for a browser extension is: edit a file, press the reload arrow on the extension card, reload the Google Photos tab, look. A build step adds a watcher that must be running and correct, and it puts the shipped code one transformation away from the code under the cursor. Source maps do not help when the failure is "Chrome refused to load the content script".

## Decision

Write plain JavaScript with JSDoc type comments. Check them with the TypeScript compiler in no-emit mode: `tsc --noEmit -p jsconfig.json`, with `checkJs`, `strict`, and `noUncheckedIndexedAccess` on. TypeScript is a development dependency and a checker only; it never produces output.

The repository root is the extension folder. `manifest.json`, `src/`, `options/`, and `icons/` sit next to `package.json`, `test/`, and `node_modules/`. Chrome ignores the files it does not reference.

Use a `/** @type {X} */ (value)` cast only at a real boundary, such as a DOM lookup or a test fake. A cast inside logic is a sign the types are wrong.

**Rejected alternative:** TypeScript with a bundler (esbuild or Vite). It gives nicer syntax for the same guarantees, but it puts a build between the editor and Chrome for a project that has no dependencies to bundle and no syntax to downlevel.

**Rejected alternative:** no type checking, JSDoc as documentation only. That drops the standard's explicit-type rule and removes the only safety net the exempt DOM adapters have, because `0006-testing-strategy.md` leaves those files without unit tests.

## Consequences

**Positive:**

- Load unpacked, edit, reload. Nothing sits between the source and the browser.
- `npm ci --ignore-scripts` plus `npm run check` is the whole CI job, and the same command runs locally.
- The type check reads every file, including the DOM adapters that carry no unit tests.

**Trade-offs and follow-up:**

- JSDoc generics and casts are wordier than TypeScript syntax, and the editor experience is slightly weaker.
- `node_modules/` sits inside the folder Chrome loads. Chrome ignores it because nothing references it, but it does bloat a manual zip. Any future packaging step must exclude it.
- If the project ever gains a runtime dependency that ships as an ES module from npm, revisit this decision, because a content script cannot resolve a bare module specifier.
