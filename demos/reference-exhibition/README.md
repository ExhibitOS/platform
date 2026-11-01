# Reference exhibition inputs

These are the exact public, approved display derivatives from the existing
reference exhibition, not original photographs or private production material.
The publication revision and static index hashes are pinned in `publication.json`.
The index, publication metadata, sixteen PNG display derivatives, and one GLB display
model are Git inputs; the Viewer JavaScript and CSS are rebuilt from this repository.

The pinned publication also includes two registered CC0 concrete footstep WAVs
and the shared CC0 license and provenance notices. The publication resource
channel verifies their sizes and SHA-256 values. Visitors explicitly enable
both sound and footsteps before sample requests; walking triggers playback.

The eight paintings are provided by The Metropolitan Museum of Art, New York under
CC0-1.0. Their original credit lines, rights, provenance, full and coarse display
asset hashes remain in the publication metadata:

- Vincent van Gogh, *Wheat Field with Cypresses*, 1889 — https://www.metmuseum.org/art/collection/search/436535
- Rembrandt, *Aristotle with a Bust of Homer*, 1653 — https://www.metmuseum.org/art/collection/search/437394
- Paul Cézanne, *Still Life with Apples and Pears*, ca. 1891–92 — https://www.metmuseum.org/art/collection/search/435883
- Edgar Degas, *Dancers, Pink and Green*, ca. 1890 — https://www.metmuseum.org/art/collection/search/436140
- Johannes Vermeer, *Young Woman with a Water Pitcher*, ca. 1662 — https://www.metmuseum.org/art/collection/search/437881
- Albert Bierstadt, *Sunrise on the Matterhorn*, after 1875 — https://www.metmuseum.org/art/collection/search/10158
- Berthe Morisot, *Young Woman Knitting*, ca. 1883 — https://www.metmuseum.org/art/collection/search/437159
- Camille Pissarro, *Morning, An Overcast Day, Rouen*, 1896 — https://www.metmuseum.org/art/collection/search/437308

The sculpture is Edmonia Lewis, *Old Arrow Maker*, modeled 1866, marble,
Smithsonian American Art Museum, Gift of Mr. and Mrs. Norman Robbins, 1983.95.179.
The Smithsonian 3D display model is supplied under CC0-1.0:

- Work record: https://americanart.si.edu/artwork/old-arrow-maker-14629
- Model record: https://www.si.edu/object/3d/old-arrow-maker%3A99ca3d6f-6d54-45a5-9b95-f8c245a662c2

The approved GLB retains the provider geometry, scale and integral oval base.
The exhibition's separate plain box pedestal and placement are authored metadata.
One simple bench in the sculpture room and its explicit seated viewpoint use the
same editable exhibition metadata; returning restores the prior view with walking
stopped. One authored spot fixture aims at a painting, with a directional
light providing the base fill. Their simple project geometry and visual colour
temperature are not a calibrated luminaire or lux measurement. Artwork files,
transforms, descriptions and rights are preserved. One painting-room plaque
references the existing exhibition title and introduction; selecting it opens
the same accessible reading panel as its menu and text-list buttons. Its small
derived near text is not the only reading route. One existing painting-room
door wall has explicit .12m depth and restrained jamb/floor/ceiling bands.
The original 2.4m opening passes through the whole depth; the same solid boxes
are used for visible geometry and walking collision, without a threshold.
Reported institutional dimensions and the digital model bounds are distinguished
in the description; physical scale has not been independently calibrated.
The nine-artist introduction, descriptions, rights, credits and display
policy remain in the generated publication metadata. The five added paintings keep
the complete photograph and its aspect ratio, anchored to the reported height;
photographic boundaries are not independently matched to the physical painted area.
Bierstadt, Morisot and Pissarro have no source ICC profile, so display sRGB is assumed and disclosed.
Morisot retains the photographed border and uses the reported 50.2 cm height;
the image aspect ratio sets its display width. Its museum-reported 60 cm width
is kept distinct from the uncalibrated photographed boundary. Morisot and Pissarro
are displayed together in the closing room; Degas remains in the painting room.
Pissarro retains the whole photograph, anchored to the reported 54.3 cm height;
its display width follows the photo aspect ratio, separately from the museum-reported 65.1 cm.
Bierstadt sits clear of the existing styled doorway wall and opening. Their full/coarse files, rights evidence and
conversion-recipe hashes remain bound in the public metadata. This independent exhibition
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

When rolling the API token used by Cloudflare Workers Builds, register its current
value as a build token and update this demo's existing trigger to use it. The token
name or ID alone does not confirm that the stored value is current. Preserve other
projects' bindings, then verify a Git-triggered build and the published index hash.
See [Cloudflare's stale API token troubleshooting](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/#stale-api-token).
