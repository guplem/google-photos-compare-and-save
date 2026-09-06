---
name: rename-symbol
description: Rename or refactor a symbol safely by searching every naming-case variant across code, tests, docs, configs, and JSON. Use when renaming any identifier so no reference is missed.
---

# Rename a symbol safely

When you rename or refactor any symbol, search **all** naming variants (camelCase, PascalCase, snake_case, kebab-case, UPPER_CASE) across the whole project (code, tests, docs, configs, and JSON), not just the obvious code references. A missed variant in a config key or a data file is the usual cause of a rename that compiles fine but breaks at runtime.

This repo has no build step and no bundler, so nothing warns you about a broken reference. The type check catches a broken import; it catches none of the traps below.

Extra traps in this repo:

- **Storage keys are data, not code.** `settings:v1` and `savedState:v1:<albumKey>` name records that already exist in a user's browser. Renaming the JavaScript constant is safe. Renaming the **stored string** orphans every cached scan result with no error. If a record shape must change, add a `:v2` key and leave the old one for the options page to clear; never rename a live key.
- **A name that lives in both JavaScript and CSS.** Every `gpcs-` class and every `data-gpcs-*` attribute is written in one place and read in another: a constant in `src/`, a selector in a `.css` file, and often a row in the `AGENTS.md` attribute table. Grep the plain string across `src/`, `options/`, and `AGENTS.md`, not just the JavaScript.
- **A setting name lives in four places.** `DEFAULT_SETTINGS`, `normalizeSettings`, an element `id` in `options/optionsPage.html`, and both `showSettings` and `collectSettings` in `options/optionsPage.js`. A missed one makes the setting reset itself with no error. Use the `add-setting` skill, which lists the same four places.
- **`manifest.json` names files, and Chrome resolves them at load time.** A file renamed or moved under `src/` must also change in `content_scripts`, `background.service_worker`, `web_accessible_resources`, `options_ui.page`, or the `css` list. A wrong path shows up only as an extension that silently does nothing.
- **Google's words are not ours to rename.** The strings in `saveLabels`, `savedLabels`, and `NEXT_CONTROL_WORDS` are the button names Google Photos renders. Never "tidy" them to match this repo's naming style; they are matched against a live page.

After a rename, run `npm run check`, then load the extension in Chrome once and open an album. The type check cannot see a broken manifest path or a broken CSS selector.
