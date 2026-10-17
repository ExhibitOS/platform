# Local CMS publication selection for Manager

`GET /api/v1/tenants/:tenantId/studio/publications` returns selection metadata for existing published Studio revisions. It uses the existing session/tenant/origin request guard. Existing Studio roles remain admin, curator and artist; administrators can see the tenant's Studio publications, while curator/artist results are restricted to exhibitions they own. Deleted or non-Studio exhibitions and withdrawn publications are excluded. No publication, approval, account or access grant is created.

The response is newest first, limited to the existing publication-list bound of 100:

```json
{"items":[{"publicationId":"<uuid>","exhibitionId":"<uuid>","title":"<up to 256 characters>","revisionSha256":"<sha256>","publishedAt":"<ISO datetime>","status":"published"}]}
```

Draft content, private metadata, object keys, credentials, session cookies and CSRF tokens are not returned. A catalog item is a selection reference, not a new quality/rights approval: the existing exporter must still recheck the public publication, current rights, immutable revision and complete asset inventory when the user selects it.

## Existing export bridge to reuse

The consumer can select a publication ID and call the existing public `exportStaticPublication({origin,publicationId,runtimeRoot,output})` from `scripts/export-static-publication.mjs`. It already restricts its source to loopback, reads the anonymous published projection and public assets, refuses redirects, validates rights/revision/content hashes, checks the publication again before completion, and atomically writes the existing static artifact. Its stdout receipt's manifest hash should populate the existing Manager native SourcePin; export failure must leave the previous selection and existing output intact.

Manager currently selects an already-exported folder. Native catalog/login/export integration is not implemented by this API change. It must retain installation selection and use the existing authentication flow; browser session stores or private draft IndexedDB are not a source catalog. No new browser/native credential-sharing mechanism is implied.

## Packaging closure, not a standalone-script claim

Copying only the exporter is insufficient. Its direct imports are Node built-ins, `@exhibitos/spec`, and `apps/api/dist/oex.js` (`checkOexProfile`). The latter currently imports the existing auth/Studio/CMS/rights/import/audio/storage modules and their public package dependencies. A packaging implementation must either preserve the locked public module dependency tree and package metadata, or bundle and verify its actual reachable closure. The spec schemas and dynamically loaded validator assets must remain available; import-graph discovery alone does not prove that all dynamic validation paths work.

The separate static Viewer runtime must include only the exporter's existing allowlist: `static.html`, `THIRD_PARTY_NOTICES.txt`, `voice-pcm-worklet.js`, and allowed JS/CSS/WASM files under `assets/` and `basis/`. The unfiltered normal web distribution includes other files and is not an accepted runtime directory. Preserve Platform AGPL source/license and third-party notices, along with the public spec's own license. No private operations/Capture source or local key/data directory belongs in this package.

Before claiming the native bridge complete, reuse the existing exporter corruption/withdrawal/atomic-preservation tests and run a packaged synthetic export with dependencies resolved from the package itself. This API's focused tests cover safe metadata projection, the existing SQL tenant/owner/state predicates, non-Studio denial, and unauthenticated/foreign-origin route rejection. They do not substitute for an actual PostgreSQL/native Manager integration test.
