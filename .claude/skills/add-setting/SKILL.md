---
name: add-setting
description: Add, rename, or remove a user setting in this extension. A setting must exist in four places, and one that misses a place resets itself with no error. Use whenever you touch DEFAULT_SETTINGS or the options page.
---

# Add a setting

A setting lives in four places. `normalizeSettings` drops every key it does not know, so a setting that misses one place fails **silently**: the options page appears to save it, and the next read hands back the default. There is no error and no failing test.

Follow these steps in order.

## 1. Write the failing test first

Add the case to `test/extensionSettings.test.js` before you touch the source, as the TDD rule in `AGENTS.md` requires. Cover the shape of the new value:

- A boolean: assert the default, and assert that a non-boolean value falls back to the default.
- A number: assert the clamp at both ends of its range.
- A list of strings: assert it lowercases and trims, and that an empty list falls back to the default.

Run `npm test` and see it fail.

## 2. Declare it in `src/settings/extensionSettings.js`

Two edits in one file:

1. Add the field to the `ExtensionSettings` typedef, with a short comment saying what it does.
2. Add the default to `DEFAULT_SETTINGS`, and add the read to the object `normalizeSettings` returns. Use the existing `readBoolean`, `readNumber`, or `readLabels` helper. A number needs a minimum and a maximum; pick a range that cannot break the scan.

## 3. Add the control to `options/optionsPage.html`

Copy the closest existing `label.row` block. The element `id` must match the setting name exactly, because `optionsPage.js` looks it up by that string. Put a number input inside the section it belongs to, and add a `.hint` paragraph when the setting needs explanation.

## 4. Wire both functions in `options/optionsPage.js`

Two edits, and both are required:

1. `showSettings` reads the stored value into the control.
2. `collectSettings` reads the control back into the object.

A setting that appears in only one of them looks saved and then reverts.

## 5. Publish it, if the page needs it

A setting that a stylesheet or the MAIN world script reads must also go through `publishSettings` in `src/contentEntry.js`, as a `data-gpcs-*` attribute, and into the attribute table in `AGENTS.md`. A setting that only the isolated world reads needs nothing here: `contentEntry.js` already holds the whole `settings` object.

A setting the MAIN world reads needs a page reload to take effect. Say so in its `.hint` text.

## 6. Finish

1. Run `npm run check`.
2. Load the extension in Chrome, open the options page, change the setting, save, reload the Google Photos tab, and confirm it took effect. The options page has no unit tests (`adr/0006-testing-strategy.md` exempts it), so this manual pass is its only coverage.
3. Update the Options table in `README.md`. Delegate to the **docs-checker** agent to catch anything else.
