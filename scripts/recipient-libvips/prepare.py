# SPDX-License-Identifier: AGPL-3.0-or-later
import hashlib
import json
import re
import shlex
import sys
from pathlib import Path

root = Path.cwd()
source, input_dir = (Path(value).resolve() for value in sys.argv[1:])
locked = json.loads(Path(__file__).with_name("source-lock.json").read_text())
archives, patches = {}, {}
for row in locked["supplierInputs"]:
    name = row["input"]
    path = input_dir / name
    with path.open("rb") as stream:
        if path.stat().st_size != row["bytes"] or hashlib.file_digest(stream, "sha256").hexdigest() != row["sha256"]:
            raise SystemExit(f"Invalid supplier input: {name}")
    item = {"path": str(path)}
    if name.endswith(".patch"):
        patches[name.removesuffix("-patch.patch")] = item
    else:
        archives[name] = item

def replace_once(script, original, replacement):
    assert script.count(original) == 1, original
    return script.replace(original, replacement)

used = set()

def local_archive(match):
    folder = match[2]
    component = {"jpeg": "mozjpeg", "zlib-ng": "zlib-ng"}.get(folder, folder)
    used.add(component)
    return "cat " + shlex.quote(archives[component]["path"]) + match[1]

script = (source / "build/posix.sh").read_text()
script = re.sub(r"\$CURL https://[^\n]+?( \| tar x[Jz]C \$\{DEPS\}/([\w-]+) --strip-components=1)", local_archive, script)
assert used == set(archives), used ^ set(archives)
for component, marker in {"glib": "glib-without-gregex.patch", "mozjpeg": "f90668e0e4fb79c81e1f24a0ccc0e2090af761bf.patch", "uhdr": "/383.patch", "vips": "libvips-cpp-soversion.patch"}.items():
    line, = [line for line in script.splitlines() if line.startswith("$CURL ") and marker in line]
    script = replace_once(script, line, "cat " + shlex.quote(patches[component]["path"]) + " | patch -p1")
script = replace_once(script, 'CURL="curl --silent --location --retry 3 --retry-max-time 30"', "")
script, n = re.subn(r'if \[ "\$DARWIN" = true \]; then\n  curl --proto .*?\nfi\n', "", script, flags=re.S)
assert n == 1
script = replace_once(script, 'export CARGO_HOME="${DEPS}/cargo"', 'export CARGO_HOME="$RECIPIENT_CARGO_HOME"')
script = replace_once(script, 'export MAKEFLAGS="-j$(sysctl -n hw.logicalcpu)"', 'export MAKEFLAGS="-j4"')
script = replace_once(script, "cargo update --workspace", 'cp "$RECIPIENT_INPUTS/librsvg-recipient-Cargo.lock" Cargo.lock')
script = replace_once(script, "cd ${DEPS}/glib\n", 'cd ${DEPS}/glib\npatch -p1 < "$RECIPIENT_INPUTS/glib-macos11-pipe2.patch"\n')
script = replace_once(script, "cd ${DEPS}/vips\n", 'cd ${DEPS}/vips\npatch -p1 < "$RECIPIENT_INPUTS/recipient-jpeg-proof.patch"\n')
script = replace_once(script, "# Cleanup\n", '# Keep ABI metadata before filtering the runtime.\ncp -R "${TARGET}/lib/pkgconfig" "$PACKAGE/recipient-pkgconfig"\n\n# Cleanup\n')
script = replace_once(script, "$CURL -O https://raw.githubusercontent.com/lovell/sharp-libvips/main/THIRD-PARTY-NOTICES.md", 'cp "$PACKAGE/THIRD-PARTY-NOTICES.md" .')
assert "curl " not in script and "$CURL" not in script
build = replace_once((source / "build.sh").read_text(), '$(brew --prefix)/bin/pkg-config', '$RECIPIENT_TOOLS/bin/pkgconf')
build = replace_once(build, 'source $PWD/build/posix.sh', 'source "$RECIPIENT_INPUTS/posix-recipient.sh"')
(root / "posix-recipient.sh").write_text(script)
(root / "build-recipient.sh").write_text(build)

boundary = 'mkdir ${DEPS}/fontconfig'
assert script.count(boundary) == 1
phase_one, remaining = script.split(boundary)
setup = script[:script.index("# Download and build dependencies from source")]
setup = replace_once(setup, "mkdir ${DEPS}\nmkdir ${TARGET}", 'test -d "$DEPS"\ntest -d "$TARGET"')
freetype = script[script.index("build_freetype() {"):script.index("build_freetype -Dharfbuzz=disabled")]
for name, phase in (("one", phase_one), ("two", setup + freetype + boundary + remaining)):
    (root / f"phase-{name}.sh").write_text(phase)
    (root / f"entry-{name}.sh").write_text(build.replace("posix-recipient.sh", f"phase-{name}.sh"))
