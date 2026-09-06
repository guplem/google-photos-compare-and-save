# Settings in sync storage, scan results in local storage, one key per album

## Context

Chrome gives an extension two storage areas, with very different limits.

- `chrome.storage.sync` follows the user's Chrome profile to their other computers. It holds about 100KB in total and about 8KB per item.
- `chrome.storage.local` stays on one computer and holds about 10MB.

The extension stores two kinds of data. **Settings** are small, and a user who changes them on one computer wants them everywhere. **Scan results** are one entry per photo, so a 2000-photo album is far past the 8KB per-item limit of `sync`, and a result is only worth as much as the cache behind it.

A write also matters. During a scan the extension writes every ten readings. If all albums shared one storage key, each write would serialize every album the user ever scanned.

## Decision

- **Settings** live in `chrome.storage.sync` under the single key `settings:v1`.
- **Scan results** live in `chrome.storage.local` under one key per album: `savedState:v1:<albumKey>`. `savedStateStore.js` is the only file that reads or writes them.
- **Never put scan results in `sync`.** A large album exceeds the per-item quota and the write fails.

Both areas are validated on read. `normalizeSettings` and `normalizeAlbumRecord` drop unknown keys and repair wrong values, because storage can hold data written by an older version of the extension. Whenever you add a field, extend the matching function and add a test.

The `:v1` suffix in each key is the migration escape hatch. If a record shape ever changes in a way `normalize` cannot repair, write `:v2` keys and leave the old ones to be cleared by the options page.

**Rejected alternative:** one `local` key holding every album. It is simpler to read, but every batched write during a scan would rewrite the whole cache, and the cost grows with the number of albums the user has ever scanned.

**Rejected alternative:** put the scan results in `sync` so they follow the user. The quota forbids it, and the value is low: a result is cheap to recreate with a scan, and it is only correct on the account that produced it.

## Consequences

**Positive:**

- A scan writes one small key, whatever else is cached.
- The options page clears every cached album with one prefix scan (`clearAllAlbums`), and it cannot touch the settings by accident because they live in a different area.
- Settings follow the user's profile, which is what a user expects from a preference.

**Trade-offs and follow-up:**

- Scan results do not follow the user to another computer. Each computer pays for its own first scan.
- Nothing evicts old albums. `local` holds about 10MB, which is thousands of albums, so this is not urgent, but a very heavy user has no automatic cleanup beyond the options-page button.
- A record carries no album name, only the key from the URL, so the options page can report a count of albums but not which ones.
