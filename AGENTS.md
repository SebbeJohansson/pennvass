# Agent notes

Bump `version` in `extension/manifest.json` with every change to the extension, in the same commit:

- patch (0.3.0 → 0.3.1): fixes and small tweaks
- minor (0.3.0 → 0.4.0): new features or settings

Chrome shows this version in `chrome://extensions`, which is how you tell whether a reload picked up the change.

After changing `extension/`, run `./scripts/install-windows.sh`. Chrome on Windows loads the copy in `%USERPROFILE%\pennvass`, not this folder, so without it the change never reaches the browser.
