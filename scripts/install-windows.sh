#!/usr/bin/env bash
# Copies extension/ to a Windows folder, because Chrome on Windows loads an
# unpacked extension unreliably from \\wsl$. Run again after every change,
# then press the reload arrow on chrome://extensions.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
profile="$(wslpath "$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')")"
target="${1:-$profile/fake-grammarly}"
mkdir -p "$target"
rm -rf "${target:?}"/*
cp -r "$here/extension/." "$target/"
echo "Copied to $(wslpath -w "$target")"
