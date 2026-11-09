# SPDX-License-Identifier: AGPL-3.0-or-later
"""Fetch and verify the pinned supplier inputs into an isolated directory."""
import hashlib
import json
from pathlib import Path
import sys
from urllib.request import Request, urlopen

def download(url, accept="*/*"):
    with urlopen(Request(url, headers={"Accept": accept, "User-Agent": "ExhibitOS-recipient-source"}), timeout=90) as response:
        return response.read()

def exact_uhdr_patch(urls):
    first = download(urls[0], "application/vnd.github.patch")
    second = download(urls[1], "application/vnd.github.patch")
    return (first.replace(b"Subject: [PATCH]", b"Subject: [PATCH 1/2]", 1) + b"\n"
            + second.replace(b"Subject: [PATCH]", b"Subject: [PATCH 2/2]", 1))

if len(sys.argv) != 2:
    raise SystemExit("usage: python3 fetch.py INPUT_DIRECTORY")
destination = Path(sys.argv[1])
destination.mkdir(parents=True, exist_ok=True)
locked = json.loads(Path(__file__).with_name("source-lock.json").read_text())
for row in [locked["supplierRecipe"], *locked["supplierInputs"]]:
    name = row.get("input") or row["file"]
    target = destination / name
    if target.exists():
        data = target.read_bytes()
    elif "commitPatchURLs" in row:
        data = exact_uhdr_patch(row["commitPatchURLs"])
    else:
        data = download(row["url"], row.get("accept", "*/*"))
    if hashlib.sha256(data).hexdigest() != row["sha256"] or ("bytes" in row and len(data) != row["bytes"]):
        raise SystemExit(f"Wrong source bytes for {name}; supply the exact pinned archive or patch")
    if not target.exists():
        with target.open("xb") as stream:
            stream.write(data)
    print(name, flush=True)
