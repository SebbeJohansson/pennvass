#!/usr/bin/env bash
# Copies extension/ to a Windows folder, because Chrome on Windows loads an
# unpacked extension unreliably from \\wsl$. Run again after every change,
# then press the reload arrow on chrome://extensions.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
profile="$(wslpath "$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')")"
target="${1:-$profile/pennvass}"
mkdir -p "$target"
rm -rf "${target:?}"/*
cp -r "$here/extension/." "$target/"
# chrome://extensions shows version_name on the card: proof of which copy is loaded.
stamp="$(git -C "$here" rev-parse --short HEAD)$(git -C "$here" diff --quiet -- extension || echo '+changes') $(date +%H:%M)"
node -e '
  const fs = require("fs"); const file = process.argv[1]; const m = JSON.parse(fs.readFileSync(file, "utf8"))
  m.version_name = `${m.version} (${process.argv[2]})`
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + "\n")' "$target/manifest.json" "$stamp"
echo "Copied to $(wslpath -w "$target") as $(grep -o '"version_name": "[^"]*"' "$target/manifest.json" | cut -d'"' -f4)"
