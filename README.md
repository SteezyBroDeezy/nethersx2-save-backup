# NetherSX2 Save Backup

A PWA that zips whatever you exported from NetherSX2's **Transfer Data →
Export**, and saves the zip to your phone's Downloads folder (or hands it
to the Android share sheet). Runs entirely on-device — nothing is uploaded
unless you pick a share destination yourself.

## Why this exists

Android's scoped storage blocks a browser (and therefore a PWA) from
reaching NetherSX2's private save folder directly, and Chrome on Android
doesn't expose a folder picker to the web. NetherSX2's own export feature
is the way around both: it writes memory card files to a folder you chose,
which a plain file picker *can* see.

## Workflow

1. In NetherSX2: menu → **Transfer Data → Export** → pick a folder you can
   get back to, e.g. `Documents/NetherSX2`. (File-based memory cards only —
   folder-type cards don't export this way.)
2. Open this app, pick those exported files (or the whole folder).
3. Tap **Save to Downloads**. The app hashes each file, skips anything
   unchanged since your last backup, zips the rest, and triggers a browser
   download straight into Downloads.
4. To restore: pick a backup from history (or a zip file) → **Restore** →
   files land in Downloads → move them into your NetherSX2 export folder →
   **Transfer Data → Import** in NetherSX2.

## Tech

- Vanilla JS, no framework or build step
- `fflate` (vendored locally in `site/vendor/`) for zip/unzip
- SHA-256 (Web Crypto) to skip unchanged files between backups
- IndexedDB for backup history, localStorage for file hashes + settings
- Service worker caches the whole app shell for offline use

## Build & deploy

```bash
npm install
npm run gen-icons   # only needed if icons change
git push            # GitHub Pages CI deploys site/ on push to main
```

Live site: https://steezybrodeezy.github.io/nethersx2-save-backup/
