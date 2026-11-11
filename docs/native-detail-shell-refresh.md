# Refresh an existing original-inclusive static shell

`scripts/refresh-native-detail-shell.mjs` creates a separate static successor from
an exact retained version-4 export and qualified web shell inputs. It does not
contact a server, use a profile, approve original custody or export a new
publication. Publication ID/revision, index bytes, detail relations, originals,
other data, material resources and the private-editor catalogue stay identical.

The Node entry reads one JSON object on stdin (maximum 64 KiB):

```json
{
  "sourceDir": "/absolute/retained-static-output",
  "sourceManifestSha256": "<64 lowercase hex>",
  "indexSha256": "<64 lowercase hex>",
  "publicationId": "<existing publication UUID>",
  "revisionSha256": "<64 lowercase hex>",
  "webRoot": "/absolute/qualified-web-shell",
  "webInventoryPath": "/absolute/web-inventory.json",
  "webInventorySha256": "<64 lowercase hex>",
  "webBuildId": "<64 lowercase hex>",
  "outputDir": "/absolute/exclusive-parent/new-static-output"
}
```

The web inventory lives outside `webRoot` and has exactly
`{format:"exhibitos-static-web-input-v1",buildId,files:[{path,bytes,sha256}]}`.
Paths are relative to `webRoot`; all its files must be listed. Accepted files are
`static.html`, optional `static-studio.html`, `assets/*.{js,css,wasm}`,
`basis/*.{js,css,wasm}`, `THIRD_PARTY_NOTICES.txt`, `viewer-favicon.svg` and
`voice-pcm-worklet.js`. Do not supply a full dist tree with catalogue/material
data: those bytes come only from the retained output. Both HTML entries carry
the exact expected `exhibitos-viewer-build-id` and one `STATIC_INDEX_SHA256`
placeholder. The public entry also carries `<!--STATIC_COVER_SHELL-->`; the
existing pinned title and cover bootstrap fill that placeholder. A retained
private editor requires `static-studio.html` in the new inputs.

The caller exclusively owns the output parent. Source, web inputs and output
must be disjoint canonical absolute paths; the final output must not exist.
The refresh verifies every source/inventory byte and the version-4 detail tuple
mapping, writes to an isolated sibling stage, checks exact publication-content
equality, revalidates source and web inputs, then renames the complete candidate
to the new destination. A new `static-export-manifest.json` inventories the
result. The receipt binds the retained content, source manifest, web inventory,
web build ID and new manifest. This is composition evidence; actual Viewer
behavior requires the designated consumer's observation of the successor.
