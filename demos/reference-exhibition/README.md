# Reference exhibition inputs

These are the exact public, approved display derivatives from the existing
reference exhibition, not original photographs or private production material.
The publication revision and static index hashes are pinned in `publication.json`.
The index, publication metadata, six PNG display derivatives, and one GLB display
model are Git inputs; the Viewer JavaScript and CSS are rebuilt from this repository.

The three paintings are provided by The Metropolitan Museum of Art, New York under
CC0-1.0. Their original credit lines, rights, provenance, full and coarse display
asset hashes remain in the publication metadata:

- Vincent van Gogh, *Wheat Field with Cypresses*, 1889 — https://www.metmuseum.org/art/collection/search/436535
- Rembrandt, *Aristotle with a Bust of Homer*, 1653 — https://www.metmuseum.org/art/collection/search/437394
- Paul Cézanne, *Still Life with Apples and Pears*, ca. 1891–92 — https://www.metmuseum.org/art/collection/search/435883

The fourth work is Edmonia Lewis, *Old Arrow Maker*, modeled 1866, marble,
Smithsonian American Art Museum, Gift of Mr. and Mrs. Norman Robbins, 1983.95.179.
The Smithsonian 3D display model is supplied under CC0-1.0:

- Work record: https://americanart.si.edu/artwork/old-arrow-maker-14629
- Model record: https://www.si.edu/object/3d/old-arrow-maker%3A99ca3d6f-6d54-45a5-9b95-f8c245a662c2

The approved GLB retains the provider geometry, scale and integral oval base.
The exhibition's separate plain box pedestal and placement are authored metadata.
One simple bench in the sculpture room and its explicit seated viewpoint use the
same editable exhibition metadata; returning restores the prior view with walking
stopped. Artwork files, transforms, descriptions and rights are preserved.
Reported institutional dimensions and the digital model bounds are distinguished
in the description; physical scale has not been independently calibrated.
The approved four-artist introduction, descriptions, rights, credits and display
policy remain in the generated publication metadata. This independent exhibition
does not imply institutional sponsorship, affiliation or endorsement.

Use Node 24.21.0 and npm 11.19.0, then `npm ci` and
`npm run build:reference-demo` from the repository root. The output is a new
`dist-demo` directory. Existing output is refused; preserve or move it before a
subsequent build. No API, database, private repository, local source file outside
this checkout, or asset download is used during the exhibition export. The API
workspace is compiled only because the existing static exporter reuses its
profile validator. Standard public package installation still requires npm.

The output preserves the existing static publication contract and text viewing
path. Hosting account, Git connection, domain, and deployment are configured
separately after their access and free quotas are verified.

The dedicated `wrangler.demo.jsonc` serves only `dist-demo` static assets. It has
no Worker handler, database binding, account credential, or domain route. The
deployment CLI is pinned in the lockfile to the same Wrangler version used by
the existing website. `npm run deploy:reference-demo` selects this explicit
configuration; run it only for the reviewed build and intended hosting account.
Unknown paths remain missing rather than returning the exhibition HTML.
