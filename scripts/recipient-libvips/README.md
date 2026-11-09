# Recipient-owned libvips and Sharp rebuild on macOS arm64

This recipe applies to the Sharp 0.35.4 and libvips 8.18.6 runtime dependencies. It builds a local replacement with an observable change to one test JPEG. The ordinary PNG scanline fix is separate. A local rebuild has its own app and runtime identity. It must use the [Manager recipient workflow](https://github.com/ExhibitOS/manager/blob/847e80027c23f4f252fd9ed13aa4752fbfb7b9e5/docs/native-recipient-build.md), which verifies a local-validation runtime independently of the official release. The official app's seal remains in place.

## Pin the inputs

Use an empty private working area with no spaces in its absolute path. Use full Xcode 27.2 build 27B52 and SDK 27.2, arm64 macOS, Python 3.14.7, Rust and Cargo 1.99.0, Node 24.21.0 with matching headers, and npm 11.19.0. The recipe selects a macOS 11.0 deployment target. The observed build and worker run used macOS 27.2.

Run `python3 fetch.py INPUT_DIRECTORY` to retrieve and hash-check the supplier recipe, 28 source archives and four supplier patches. The commit and version routes are checked against exact bytes; version URLs can change. The exact versions, URLs and checksums are in [source-lock.json](source-lock.json). If a mirror or transient fetch fails, place the exact file under the named input entry and rerun the command. For libultrahdr, the downloader assembles the two exact upstream commit patches into the checked supplier series.

The two changes in this directory are part of the local recipe. The GLib patch selects the existing fallback for targets before macOS 27. The JPEG proof patch changes the first decoded RGB pixel of the 257×193 fixture geometry. The latter is a test change and affects any matching JPEG in the local build.

## Prepare private build tools

- Download the exact CMake 3.31.6, Ninja 1.13.0, Meson 1.9.1 and Meson 1.11.0 wheels from PyPI. Verify the filenames and SHA-256 values in `source-lock.json`. Create two Python environments. Install the matching Meson wheel and the common CMake and Ninja wheels in each with `pip install --no-index`. Set `MESON_OLD_BIN` and `MESON_NEW_BIN` to their bin directories.
- Get pkgconf 2.5.1 from the [pkgconf distribution site](https://distfiles.ariadne.space/pkgconf/) and NASM 2.16.03 from the [NASM release directory](https://www.nasm.us/pub/nasm/releasebuilds/2.16.03/). Verify the archive hashes in `source-lock.json`. For each extracted tree run `./configure --prefix="$RECIPIENT_TOOLS"`, `make -j4`, then `make install` with a private `RECIPIENT_TOOLS` prefix.
- Create a private `RECIPIENT_CARGO_HOME`. Obtain the checked cargo-c crate from `source-lock.json`, extract it, and verify its embedded `Cargo.lock` digest. Set `CARGO_HOME="$RECIPIENT_CARGO_HOME"` and run `cargo fetch --locked --target aarch64-apple-darwin` in that crate to seed the registry index and archives. Install with `cargo install --locked --offline --path . --root "$RECIPIENT_TOOLS"`.
- Seed librsvg's Cargo inputs separately. In a disposable directory extract the checked input `rsvg` with `tar -xJf` and `--strip-components=1`. In that directory apply the supplier feature edits shown below, copy this directory's `librsvg-recipient-Cargo.lock` over its `Cargo.lock`, then run the same target-specific locked Cargo fetch. Cargo's lock checksums pin the crate inputs.

```sh
sed -i'.bak' '/image = /s/, "gif", "webp"//' rsvg/Cargo.toml
sed -i'.bak' '/cairo-rs = /s/, "pdf", "ps"//' librsvg-c/Cargo.toml rsvg/Cargo.toml
```

Export the two Meson bin paths, private tool and Cargo paths, and `DEVELOPER_DIR` for full Xcode. Put the chosen Rust and Python tools on `PATH`. Run `bash build.sh INPUT_DIRECTORY NEW_BUILD_DIRECTORY`. The adapter builds through libarchive in the new prefix, then continues at Fontconfig in the same prefix with Meson 1.11.0. It emits the verified dylib, generated headers and versions in its supplier archive. Keep the directory in place between phases.

## Rebuild Sharp and the local runtime

Use the exact Platform source and lock for the chosen runtime. The historical JPEG comparison used [Platform 2fb4df6](https://github.com/ExhibitOS/platform/commit/2fb4df6676887d7fce8b245078cc1c8bffa3344f). The corrected PNG producer is [Platform 273b0bb](https://github.com/ExhibitOS/platform/commit/273b0bbb054b357c3ac7d5a354ff78924747734d). Choose the actual source matching your runtime manifest.

1. In a private build copy install the dependencies from the runtime's exact Platform lock. For node-gyp and node-addon-api use this directory's `package.json` and lock in a private directory with `npm ci --ignore-scripts`. The lock pins tarball integrity and registry URLs. Set `NODE_PATH` to that private installation for the build.
2. From the supplier output directory verify `shasum -a 256 -c ../libvips-output.sha256`, then extract the built libvips archive into a separate work directory. Install its generated `include` tree as `@img/sharp-libvips-dev/include` using the supplier's `npm/dev/package.json` and an `include/index.js` that exports `__dirname`. Place the rebuilt dylib, `versions.json`, and generated GLib headers in the existing `@img/sharp-libvips-darwin-arm64` layout. Do this before compiling Sharp. Preserve the matching Sharp 0.35.4 JavaScript sources.
3. Set `SHARP_IGNORE_GLOBAL_LIBVIPS=1`, `MACOSX_DEPLOYMENT_TARGET=11.0`, and `PYTHON` to the selected Python executable. Run the pinned tool's `node-gyp rebuild --directory PATH_TO_SHARP/src --nodedir PATH_TO_NODE_24_21_0 --jobs 4`. Verify the addon lists `@rpath/libvips-cpp.8.18.6.dylib` in `otool -L` and `@loader_path/../../sharp-libvips-darwin-arm64/lib` in `otool -l`. Local ad hoc signing of the rebuilt Mach-O files, when needed, is confined to the private local copy.
4. Use a new local-validation runtime, preserve its original source commit and regenerate its inventory after installing the two rebuilt files. Use the Manager recipient build instructions for local admission. The rebuilt runtime needs a fresh local manifest and explicit admission by its locally built app.

For a local behavior check, prepare a baseline RGB JPEG of 257×193 pixels. Compare the worker's output with and without the replacement in otherwise equivalent runtime copies. The modified worker should return first pixel `[17,193,61]`; the second pixel should match the baseline. Verify the worker exits and record the actual runtime, native library and addon digests. The historical clean relocation used the same Mac, local Cargo/npm index bootstrap data and an exact prebuilt baseline. Network-only bootstrap and another host remain separate tests.
