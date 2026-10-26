# Local brand marks

Studio retains its existing draft-1 mark. Viewer uses the approved artwork-frame
role mark and outlined ExhibitOS wordmark, copied as exact local SVG sources.
`provenance.json` binds their exact bytes to the reviewed canonical manifest.
Run `node scripts/generate-brand-marks.mjs` to reproduce the inline React
components. The generator accepts only the pinned sources, preserves geometry,
normalizes namespace/React attributes, removes IDs/title, and makes each mark
decorative. Viewer has one labelled brand at its existing footer location.

Studio and CMS import only StudioMark; PublicPublication imports ViewerMark and
ExhibitOSWordmark at its existing footer.
Static Viewer also references the approved local `viewer-favicon.svg`. The static
exporter permits that exact pinned SVG only. The outlined wordmark requires no
font file; its notice and original Manrope OFL are included by `npm run notices`.
Generation is maintenance only: product builds use the checked-in local modules
and do not access an authoring repository. This vendor copy creates no separate
public brand reuse license or rights claim for other assets.
