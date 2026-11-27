#!/usr/bin/env bash
# Builds the in-game viewer mod's release zip: <name>_<version>.zip holding one folder, <name>_<version>/,
# which is the layout Factorio expects. Only what the game loads goes in (not mod/spec, mod/tools, the
# Lua toolchain setup or the manual checklist). The version written into info.json is the argument, so that
# the zip, the folder and info.json agree, which Factorio requires.
#
# Usage: scripts/package-viewer-mod.sh <version, e.g. 0.6.0 (a leading v is dropped)> <output directory>
set -euo pipefail

version="${1:-}"
outdir="${2:-}"
if [[ -z "$version" || -z "$outdir" ]]; then
  echo "usage: $0 <version> <output directory>" >&2
  exit 2
fi
version="${version#v}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "version must look like 1.2.3, got '$version'" >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$outdir"
outdir="$(cd "$outdir" && pwd)"
name="$(node -p "require('$root/mod/info.json').name")"
folder="${name}_${version}"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/$folder/graphics"
cd "$root/mod"
cp control.lua data.lua settings.lua "$stage/$folder/"
cp -R lib locale scripts "$stage/$folder/"
cp graphics/button-x56.png "$stage/$folder/graphics/"
node -e '
  const fs = require("fs");
  const info = JSON.parse(fs.readFileSync("info.json", "utf8"));
  info.version = process.argv[1];
  fs.writeFileSync(process.argv[2], JSON.stringify(info, null, 2) + "\n");
' "$version" "$stage/$folder/info.json"

rm -f "$outdir/$folder.zip"
(cd "$stage" && zip -qr -X "$outdir/$folder.zip" "$folder")
echo "$outdir/$folder.zip"
