---
name: debug
description: Root-cause a bug or a failed fix with evidence, not guesses - brainstorm causes, research them in parallel, confirm one with logs before changing code. Use when a reported behavior needs root-causing or a fix attempt has failed.
---

# Debug with evidence, not guesses

A plausible-looking cause is not enough. Turning a symptom into a fix by pattern-matching wastes a commit and loses trust. Confirm the real cause with evidence before you edit code.

1. **Brainstorm causes.** List several plausible root causes (more for a hard bug, fewer for an obvious one). Do not commit to the first idea.
2. **Research in parallel.** When the causes sit in different areas, spawn one subagent per area (a subagent is a separate agent you launch with the Agent tool) to trace that suspected code path and report whether it can actually produce the reported behavior. This keeps the files they read out of your own context. Give each subagent one focused question.
3. **Rank the causes, most likely first.** Order the surviving causes by how well they fit the evidence so far.
4. **Confirm one with targeted logs, in that order.** For the top cause, add a log line (or a breakpoint, or a small test) that would prove or disprove it, run the failing path, and read the output. Move to the next cause only after the current one is disproven. Never change logic on a theory you have not confirmed.
5. **Match the fix to the confirmed cause.** Fix exactly what the evidence points to. If the change you want to make does not address the confirmed symptom, say so and ask first; do not slip a "nice-to-have" in as a bug fix.
6. **Broaden if every theory fails.** The same symptom can come from outside the obvious code. In this repo, check these before you widen the search further:
   - **A stale extension.** Chrome keeps the old code until you press the reload arrow on the extension card at `chrome://extensions`, and the page keeps the old content script until you reload the tab. Do both, in that order.
   - **The content script never started.** Look for `[Compare & Save] failed to start` in the page console, and for a red "Errors" button on the extension card. A wrong path in `manifest.json` or a missing `web_accessible_resources` entry fails silently otherwise.
   - **Stale storage from an older version.** A wrong badge often comes from a cached scan result, not from live code. Clear it on the options page.
   - **Google Photos renamed a button.** Press **Copy diagnostics** in the control panel and read `toolbarControlNames`. If the save label is not in the list, the probe is correct and the label list is wrong.
   - **The MAIN world patch is running on defaults.** It starts before `chrome.storage` resolves, so a settings change needs a page reload. Check `document.documentElement.dataset.gpcsMainWorld` in the console.
   - **A dialog is open.** An open "Edit date/time" dialog makes every probe return `null`, which the scan reports as `unknown`.

Remove the logs you added once the cause is confirmed.
