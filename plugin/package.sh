#!/bin/sh
# Builds the plugin's release zip, dist/earlyeditionkids.koplugin-<version>.zip,
# with the version stamped into const.lua and _meta.lua. Leaves out config.lua,
# so an update never overwrites anyone's own settings.
#
#   plugin/package.sh v1.0.0     (the version defaults to "dev")
set -eu
VERSION="${1:-dev}"
VERSION="${VERSION#v}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../dist"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/eek-plugin.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

cp -R "$HERE/earlyeditionkids.koplugin" "$TMP/"
P="$TMP/earlyeditionkids.koplugin"
rm -f "$P/config.lua"
find "$TMP" -name .DS_Store -delete
for f in "$P/earlyeditionkids/const.lua" "$P/_meta.lua"; do
    sed -i.bak "s/VERSION = \"dev\"/VERSION = \"$VERSION\"/; s/version = \"dev\"/version = \"$VERSION\"/" "$f"
    rm -f "$f.bak"
    grep -qi "version = \"$VERSION\"" "$f" || { echo "could not stamp the version into $f" >&2; exit 1; }
done

mkdir -p "$OUT"
ZIP="$OUT/earlyeditionkids.koplugin-$VERSION.zip"
rm -f "$ZIP"
(cd "$TMP" && zip -qrX "$ZIP" earlyeditionkids.koplugin)
echo "$ZIP"
