#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail
umask 077
[ "$#" -eq 2 ] || { echo "usage: bash build.sh INPUT_DIRECTORY NEW_BUILD_DIRECTORY" >&2; exit 2; }
recipe_source="$(cd "$(dirname "$0")" && pwd -P)"
inputs="$(cd "$1" && pwd -P)"
mkdir "$2"
cd "$2"
export RECIPIENT_INPUTS="$(pwd -P)"
case "$RECIPIENT_INPUTS" in *[[:space:]]*) echo "Build directory must have no whitespace" >&2; exit 2;; esac
export RECIPIENT_TOOLS="${RECIPIENT_TOOLS:?private tool prefix required}"
export RECIPIENT_CARGO_HOME="${RECIPIENT_CARGO_HOME:?isolated Cargo cache required}"
export CARGO_HOME="$RECIPIENT_CARGO_HOME" CARGO_NET_OFFLINE=true CARGO_BUILD_JOBS=4
export PATH="$RECIPIENT_TOOLS/bin:$PATH"
test "$(uname -sm)" = "Darwin arm64"
test "$("$MESON_OLD_BIN/meson" --version)" = 1.9.1
test "$("$MESON_NEW_BIN/meson" --version)" = 1.11.0
test "$(pkgconf --version)" = 2.5.1
cargo cbuild --version | grep -F '0.10.18+cargo-0.92.0'
printf '%s  %s\n' aea60d36644f88b47a3998564f12264fd7638dc4559f083e9ff3fb25c9caa87b "$inputs/supplier-recipe.tar.gz" | shasum -a 256 -c
tar -xzf "$inputs/supplier-recipe.tar.gz"
source="$RECIPIENT_INPUTS/sharp-libvips-6e5971d333377743163edc3ad9e5d0b897abcbc9"
cp "$recipe_source"/{glib-macos11-pipe2.patch,recipient-jpeg-proof.patch,librsvg-recipient-Cargo.lock} "$RECIPIENT_INPUTS/"
python3 "$recipe_source/prepare.py" "$source" "$inputs"
cd "$source"
PATH="$MESON_OLD_BIN:$PATH" /bin/bash "$RECIPIENT_INPUTS/entry-one.sh" darwin-arm64v8
PATH="$MESON_NEW_BIN:$PATH" /bin/bash "$RECIPIENT_INPUTS/entry-two.sh" darwin-arm64v8
cmp deps/rsvg/Cargo.lock "$RECIPIENT_INPUTS/librsvg-recipient-Cargo.lock"
otool -L target/lib/libvips-cpp.8.18.6.dylib
shasum -a 256 sharp-libvips-darwin-arm64v8.tar.gz target/lib/libvips-cpp.8.18.6.dylib target/versions.json > "$RECIPIENT_INPUTS/libvips-output.sha256"
