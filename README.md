# Google Photos Compare & Save

A Chrome extension for the Google Photos website. It does two things.

**1. It swaps photos instantly.** Google Photos slides one photo out while the next slides in. When you press the arrow keys fast, the two photos overlap and you cannot compare them. This extension removes the slide, so each press shows one clean photo.

**2. It marks the shared-album photos you have not saved.** In a shared album, Google Photos shows a **Save** button only for the photos that are not yet in your own library. You must open each photo to find out. This extension puts an amber badge on every thumbnail that still needs saving.

![the badge is an arrow dropping into a tray](icons/icon128.png)

## Install

The extension is not on the Chrome Web Store. Load it from this folder.

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**, at the top right.
4. Click **Load unpacked**.
5. Select the folder that holds `manifest.json`.

Chrome keeps the extension until you remove it. To update it, pull the new code and click the reload arrow on the extension card.

## Use

### Instant swap

It works at once. Open any photo and press the left and right arrow keys.

If the slide is still there, open the options page and turn on **Also shorten JavaScript animations**. Then reload the Google Photos tab. That setting is off by default because it touches every animation on the page, not only the photo swap.

### Unsaved badges

1. Open a shared album.
2. Find the **Compare & Save** panel at the bottom left.
3. Click it to open, then click **Scan album**.

The scan scrolls the grid back to the top, opens the first photo, then steps through the album with the right arrow key. It reads the toolbar of each photo and writes the answer down. The panel shows the count and the time per photo. Click **Stop scan** at any time. Results already found are kept.

When the scan ends, the grid shows an amber badge on every photo that is not in your library.

The scan takes a few minutes for a large album, because it must open each photo. You only pay that cost once per album: results are cached. A later scan skips the photos it already knows, unless you turn on **Read every photo again on each scan**.

You do not have to scan at all. The extension also records the state of every photo you open by hand, so normal browsing fills the badges in over time.

## Options

Click the extension icon in the Chrome toolbar, or click **Options** in the panel.

| Setting                                 | What it does                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Swap photos instantly                   | Turns feature 1 on or off.                                                                              |
| What to shorten                         | `CSS transitions only` is safe. `Transitions and keyframe animations` is stronger.                      |
| Tell the page you prefer reduced motion | Makes the site think you asked for less motion. Needs a page reload.                                    |
| Also shorten JavaScript animations      | Last resort for a slide that survives the CSS settings. Needs a page reload.                            |
| Show a badge                            | Turns feature 2 on or off.                                                                              |
| Fade the photos you already saved       | Extra contrast between saved and not saved.                                                             |
| Read the toolbar every                  | How often the scan looks at the toolbar.                                                                |
| Ignore the first (ms) of each photo     | Skips the moment when the toolbar still shows the previous photo.                                       |
| Confirm "saved" for                     | How long a photo must show no Save button before the scan believes it. Raise this on a slow connection. |
| Button names                            | The words the extension looks for. See below.                                                           |

## Troubleshooting

### Every photo shows a badge, or no photo does

The extension decides whether a photo is saved by reading the names of the toolbar buttons. Google Photos writes those names in your own language, and can rename them at any time.

1. Open a photo in the album.
2. Open the panel and click **Copy diagnostics**.
3. Paste the result into a text editor.
4. Look at `toolbarControlNames`. That is the list of names the extension found.
5. Copy the name that means "save" into the **Names that mean "not saved yet"** box on the options page, one per line.

The diagnostics report contains no photo ids and no album ids.

### The scan stops early and says it could not reach the next photo

The scan moves forward with the right arrow key, and then with a button whose name contains a word for "next". It never clicks a button it cannot name, because a blind click once opened the **Edit date/time** dialog. If both ways fail, the scan stops instead of guessing. Send the diagnostics output.

### The scan is slow

Each photo costs about one fifth of a second when it is not saved, and about half a second when it is. A photo the scan already knows costs almost nothing, so a second scan of the same album is fast. To speed up a first scan, lower **Confirm "saved" for**. Do not lower it below the time your connection needs to draw the toolbar, or the scan starts reporting photos it could not read.

### The badges are stale

Google Photos reuses the same thumbnail elements as you scroll, so a badge follows the photo, not the position. If a badge looks wrong after you save a photo by hand, open that photo once. The extension re-reads it and corrects the badge.

To start over, open the options page and click **Delete all cached album results**.

## Privacy

Everything stays in your browser.

- The extension runs only on `https://photos.google.com`.
- Scan results live in Chrome's local extension storage, on this computer.
- Settings live in Chrome's sync storage, so they follow your Chrome profile.
- The extension sends no network requests of its own and contacts no server.

## Limits

- Google Photos changes its layout without notice. When it does, the badges break and the button names need updating. The instant swap is much less likely to break.
- The scan reads the toolbar. If Google ever stops showing a **Save** button for unsaved shared photos, this approach stops working.
- The official Google Photos API cannot answer "is this photo in my library". That is why the extension reads the page instead. See `CLAUDE.md` for the reasoning.

## Develop

```bash
npm install
npm run check
```

`npm install` also installs the git hooks, through lefthook. From then on, every commit runs the format check and the type check first.

`npm run check` runs the three checks in order: Prettier, the TypeScript type checker, and the unit tests. It is the same command the GitHub Actions job runs on every pull request.

The code is plain JavaScript with JSDoc types, so there is no build step: the folder you edit is the folder Chrome loads. Edit a file, press the reload arrow on the extension card, then reload the Google Photos tab.

To redraw the icons, run:

```bash
powershell -ExecutionPolicy Bypass -File scripts/makeIcons.ps1
```

## Licence

MIT. See `LICENSE`.
