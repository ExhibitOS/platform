# Studio immutable publication and withdrawal

Publication is an explicit server action on a saved remote Studio draft. Local edits, online reconnection and CMS approval alone do not publish. Confirm the server account, save/compare the remote revision, then request its READY report. The report contains the exact strong ETag and bounded issue code/path/message/remediation entries. Correct the listed fields and save again. Publish repeats server authorization, the ETag check and full readiness validation; a previously green report is not authorization to publish a newer revision.

## READY profile

Full public geometry, references, artwork rights at publication time, accessibility metadata and Platform material/presentation extensions must validate. Each artwork must exactly match a current reviewed immutable CMS snapshot from this tenant, with qualified GLB/PNG display bytes and current artwork/asset display grants. Arbitrary inventory URLs, edited snapshot rights/dimensions, unapproved assets and unsupported audio/media publication fail closed with corrective guidance. This stage qualifies noncommercial display; it does not grant commercial, original-download or export rights. At most64 artworks and64MiB total qualified derivative bytes are published. Existing preview complexity bounds still apply.

## Explicit publish and immutable source

Choose the READY revision publish action. A strong If-Match plus a UUID requestId controls the transaction. An exact lost-response retry returns the recorded publication's current status and does not activate it again. Changed request intent requires a new UUID. A stale draft ETag returns412; readiness failures return422. The resulting `/p/{publicationId}` URL reads a stored immutable public OES projection, never the mutable private authoring draft. Published source drafts remain frozen even after withdrawal; create a new local draft/fork, save it as a new remote exhibition and publish a new revision to change content.

All public IDs/references are remapped. CMS account/tenant bindings, private notes, storage keys, original URLs, and unrecognized exhibition/artwork extension namespaces are excluded. Only the known material/presentation metadata crosses this boundary. Public artwork inventory describes the qualified derivative's exact size/hash; mapped anonymous asset endpoints are the fetch URLs. Immutable publication, assets, events and receipts are protected against update/delete; separate state tracks availability.

## Anonymous preview and current rights

The anonymous page offers a bounded geometry/artwork preview and a text artwork/credit/description list. It uses dedicated anonymous endpoints with credentials omitted and no-store. Before decoding a derivative, it checks the publication revision header and actual byte size/SHA-256. It never fetches private CMS/authoring endpoints or submitted inventory paths. API and artwork bytes are excluded from the public Studio service-worker cache. This is a development anonymous preview, not the later full Viewer/visitor runtime or complete accessibility certification.

Every metadata/asset request rechecks current publication availability, tenant/artist/artwork/asset state, exact governing approval, snapshot and current artwork/asset display grants, expiry and integrity. A shared policy lock excludes concurrent authenticated withdrawal/approval/rights changes; byte reads recheck time-dependent grants after storage I/O before returning bytes. Any failed gate returns404 for the entire publication and every public asset, with no cached304 bypass. Changing/reapproving source CMS metadata conservatively makes the old publication unavailable, even if display remains allowed; import the new approval into a new draft/publication. Private authoring draft changes do not rewrite published snapshots.

## Withdraw and restore

Use explicit withdrawal in the owned publication list. State becomes unpublished; anonymous metadata and all bytes return404. Rechecking/reloading the anonymous page clears its prior projection. No snapshot, asset or historical record is deleted. If the old immutable approval and current grants are still valid, explicit republish restores the same URL and records an event. Rights revoked/expired or changed approval cannot be bypassed by republish. Publish/unpublish/republish and relevant rights changes have append-only audit evidence. Already received bytes cannot be erased remotely; withdrawal is future access control, not DRM.

## Storage and recovery

Additive migration007 introduces studio_publications, publication_states, publication_assets, publication_events and publication_requests. Publication derivative keys join referenced-object retention and consistent backup inventory. Git bundles do not include these DB rows or blob bytes. Restore them together under the existing maintenance protocol, verify hashes/current grants, and use a fresh environment; synthetic integration archives are not production restore points. Original migrations001–006 remain unchanged. No private repository or new browser dependency is required.

Run `npm run test:publication` with the documented exact Node/npm, Docker and Chromium environment. [Publication OpenAPI](../contracts/publication-openapi.json) defines protected and anonymous routes, errors and bounds. The current profile excludes audio/OEX, hosted production deployment, full Viewer controls, real-device GPU qualification and automated production backup scheduling.
