# Reviewable text assistance

T11-02 preserves the artist source separately from metadata or translation proposals. This service uses actual CMS ownership/membership checks, immutable source revisions, current rights and existing CMS revision/approval invalidation. It does not install or call an AI provider, fetch URLs, read private artwork bytes or transform artwork imagery. Imported AI text is labelled as a submitted proposal; its generation is not independently attested.

## Integration contract

The root HTTP router wires these methods under authenticated `.../cms/artworks/:artworkId/assistance`, within the existing authenticated, CSRF-checked, auth/maintenance-fenced transaction. `Assistance` takes an existing `Cms` instance (optional).

- GET `/`: `list(client, session, artworkId)` returns at most 128 owner-visible source/proposal/review/application records. This history is private, not a public publication endpoint.
- POST base `/assistance`: `request(..., input)` requires exactly `kind` (`metadata` or `translation`), `field` (`title`, `description`, `medium`), current `revision`, UTF-8 `sourceSha256`, `locale` (translation language tag or metadata null), `origin` (`human`, `local-ai`, `external-ai`), `provider`, `externalConsent`. Nonexternal input requires null provider and false consent. External input requires an explicit named provider, true consent, matching source hash and current export rights. The returned source text is the exact stored source. `externalTransmissionExecuted` is always false. This records consent for preparation, not proof that a provider received or generated anything.
- POST `/requests/:id/proposals`: `propose(...)` requires exactly `text`, `tool`, `toolVersion`. Text remains separate and unreviewed. No API keys, endpoints or commands are accepted.
- POST `/proposals/:id/review`: `review(...)` requires exactly `decision` (`accepted` or `rejected`), matching source `revision` and `sourceSha256`. Current owner/admin explicitly reviews it; no automatic acceptance. One immutable decision per proposal.
- POST `/proposals/:id/apply`: `apply(...)` accepts only a human-accepted metadata proposal whose original source revision/hash is still current. Existing `Cms.revise` creates a new immutable snapshot and clears asset/artwork approval. Reapproval and the existing publication workflow are still required. Rights, physical dimensions and original snapshots are preserved. AI text records AI assistance, proposal/tool and original hash in provenance.

Reviewed translations remain separate source/target records with locale and human decision. They do not overwrite the artist original or automatically publish into exhibition annotation/translation snapshots; the root Studio integration must deliberately carry accepted records into its existing reviewed translation flow. A stale source, deleted artwork/artist, withdrawn membership or external export rights fails closed. Existing historical records survive for review, subject to the project's account deletion/backup retention policy; this migration does not claim erasure or provider-side deletion.

## Validation scope

Small regression checks cover explicit consent, closed inputs, original preservation, current-source/rights refusal, and actual `Cms.revise` approval clearing with synthetic database responses. These are component checks, not actual PostgreSQL/HTTP/UI or external AI generation/translation execution. Route wiring, migration execution, human review UI and full private-to-public translation integration are not validated by this source-only component. No paid resource or external AI transmission has run.
