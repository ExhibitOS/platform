# Reference exhibition inputs

These are the exact public, approved display derivatives from the existing
reference exhibition, not original photographs or private production material.
The publication revision and static index hashes are pinned in `publication.json`.
The index, publication metadata, and all 31 registered display asset entries are
Git inputs; the Viewer JavaScript and CSS are rebuilt from this repository. The
publication contains 15 works in five rooms. Four registered audio and notice
resources are included. The input index is
`2e7174ff9cd805a5e72bf084adda8a6e9169696a214d74052b052547e73fd6fd`;
the publication is `a3a7434d-1915-4f21-a133-1604746534a5`, revision
`2ecfb415f54f58a1619058a7931e37f105a3c1135f87e7e27157d5f9e411b6f2`.

The painting-room floor uses the user-authored Quiet Oak Herringbone material,
`quiet-oak-herringbone/1`, with its CC0 notice and a 0.9 m repeat. This is a
bounded visual presentation; physical appearance and wood audio are not qualified.

The pinned publication also includes two registered CC0 concrete footstep WAVs
and the shared CC0 license and provenance notices. The publication resource
channel verifies their sizes and SHA-256 values. Visitors explicitly enable
both sound and footsteps before sample requests; walking triggers playback.

The fourteen paintings are provided by The Metropolitan Museum of Art, New York under
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
- Gustave Courbet, *The Hidden Brook*, ca. 1873–77 — https://www.metmuseum.org/art/collection/search/436013
- Édouard Manet, *The Brioche*, 1870 — https://www.metmuseum.org/art/collection/search/436946
- John Singer Sargent, *Egyptian Woman*, 1890–91 — Gift of Mrs. Francis Ormond, 1950
- Winslow Homer, *Cannon Rock*, 1895 — Gift of George A. Hearn, 1906
- Camille Pissarro, *Washerwoman, Study*, 1880 — Gift of Mr. and Mrs. Nate B. Spingold, 1956
- Édouard Manet, *Fishing*, ca. 1862–63 — Purchase, Mr. and Mrs. Richard J. Bernhard Gift, 1957

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
The exhibition introduction, descriptions, rights, credits and display
policy remain in the generated publication metadata. The paintings keep
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

Sargent retains the approved complete photograph without cropping or stretching.
Its displayed height is .648m and its photo-aspect width is approximately .5452m;
the museum-reported .533m width is a separate measurement. The photographed painted
boundary is not independently calibrated. The approved full 1599×1900, coarse,
and thumbnail PNG bytes are preserved with their existing registered hashes.
Automatic quality may retain the coarse image under its budget; selecting higher
quality uses the existing Viewer policy and does not change these content inputs.

One transition-room wall has an authored fine-gallery-concrete texture binding
with a two-metre repeat. The immediately preceding public projection is retained
in the private-copy base inventory. The material is a visual preset; it does not
establish a measured physical colour, grain, or surface finish.

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
