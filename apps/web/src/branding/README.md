# Open gallery header marks

The two locally vendored canonical SVGs are project-authored draft-1 role marks.
`provenance.json` binds their exact bytes to the reviewed canonical manifest.
Run `node scripts/generate-brand-marks.mjs` to reproduce the two inline React
components. The generator accepts only the two pinned sources, preserves their
geometry, removes document IDs/title, and makes each mark decorative. Existing
header text, link names, navigation and inherited theme colors remain in charge.

Studio and CMS import only StudioMark; PublicPublication imports only ViewerMark.
Static Viewer therefore needs no SVG file request or asset-policy expansion.
Generation is maintenance only: product builds use the checked-in local modules
and do not access an authoring repository. This vendor copy creates no separate
public brand reuse license or rights claim for other assets.
