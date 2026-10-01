# T03-02 room, surface, door and material editor

Implemented on `codex/studio-geometry`, based on merged T03-01 `275c630`. Independent verification is recorded below; the pull request records merge status.

The editor applies typed reversible commands to the full public OES candidate. It creates rooms and six-plane white cubes; edits rigid room/surface transforms, dimensions, wall openings and reciprocal door connections; stores bounded optional PBR appearance in `org.exhibitos.studio/materials`. Full public validation plus shared own-namespace validation runs before browser persistence and remote writes. Existing ownership, CAS, strong ETags, immutable snapshots, backups and account-independent offline shell are retained. No migration or private dependency was introduced.

Actual checks on the candidate:

- Node24.21.0/npm11.19.0 `npm ci`: 257 packages installed, audit0 vulnerabilities. Subsequent `npm run check` at 2026-10-01T10:31:45Z: typecheck/lint PASS, 21 unit tests PASS, 8 public contract tests PASS, independent production build and 10 third-party notices PASS. Vite reports its existing large-chunk warning; this is not a production performance certification.
- Five model tests exercise six plane orientations and meter placement, invalid dimensions/quaternions/scales/reference rejection without state mutation, reciprocal door transitions and referenced removal refusal, exact undo/redo with 20-snapshot retention and redo branching, material version/reference/case-alias/value rejection through generic JSON validation.
- `node scripts/test-geometry.mjs`: five actual production Chromium groups PASS. Native IndexedDB persists transformed rooms and white cubes; door/material commands undo/redo preserve unrelated namespaces; WebGL red-wall pixels change when a real opening is removed then undo restores the cutout; invalid inputs preserve the prior candidate; HTTP-cache-disabled offline navigation is served by the installed service worker and reopens exact geometry/materials. Keyboard camera and 375px viewport checks PASS. Mixed-case public UUID references retain room rendering and selected material projection.
- Isolated PostgreSQL/API-only `EXHIBITOS_DRAFTS_SKIP_BROWSER=1 node scripts/test-drafts.mjs`: 10 groups PASS at 2026-10-01T10:27:58Z, including valid materials and unrelated extension remote roundtrip, malformed material PUT rejection retaining the original revision, malformed POST rejection with no row/receipt, current-role/owner/tenant authorization, concurrent CAS and exact replay, immutable snapshots, and actual pg_dump/restore equality.
- `npm run test:e2e`: existing foundation Chromium 3/3 PASS.

- Final full `node scripts/test-drafts.mjs`: 21 groups PASS at 2026-10-01T10:29:52Z (10 actual API/PostgreSQL groups, 2 native IndexedDB probes, 9 production UI groups). Existing quota rollback, interrupted transactions, 51 retained histories/newest50 window, future-version raw rescue, offline geometry/placements reload, local CAS fork, remote receipts/conflict/application and account-binding boundaries all passed with the geometry editor present.
- Final `node scripts/test-auth.mjs`: 18 actual groups PASS; `node scripts/test-import.mjs`: 11 actual groups PASS; `node scripts/test-cms.mjs`: 17 actual groups PASS, including the existing production Chromium8 groups. All processes exited0 using synthetic isolated PostgreSQL/filesystem fixtures.

Visual inspection: the final selected-face screenshot shows a red wall with an actual floor-touching rectangular opening, not a painted door. The 375px screenshot has coherent controls and no horizontal overflow. Final artifact paths are temporary machine evidence, not production assets:

- `/var/folders/x7/dfgr2r697vj8kb6bg3207nx40000gn/T/exhibitos-geometry-lDuCwm/door-opening.png`
- `/var/folders/x7/dfgr2r697vj8kb6bg3207nx40000gn/T/exhibitos-geometry-mobile-0ycrDL/mobile-geometry.png`

Compatibility and limits: public base OES remains unchanged; other clients may ignore the optional material extension. Existing drafts without it use defaults. Unknown own versions fail closed without rewriting. Undo is a session history; durable local recovery remains separate. The bounded preview does not render artwork assets, curved walls, stairs, thickness, physics or a Viewer. Door pairing validates reciprocal references between rooms, not architectural adjacency. See [wire contract and preview limits](studio-geometry.md).

## Independent acceptance

Root tested exact commit `1b4bef7c9cfb431d816ea8cfbdcfa2bcbbb8c0ab` in a fresh clone outside the workspace using Node24.21.0/npm11.19.0. `npm ci` and `npm run check` passed (21 unit tests, 8 contract tests, typecheck, lint, production build and production notices). All seven independent integration processes exited0: geometry5, drafts21, auth18, import11, CMS17, actual storage backup/restore and S3 restart, and foundation Chromium3. The storage fixture uses synthetic isolated PostgreSQL and blob data; it is not a production recovery point. Four OpenAPI documents passed SwaggerParser validation; 24 changed Markdown local targets and unchanged migrations001–006 were verified. Independent read-only source review found no blocking defects.

Root visually inspected its independently generated door-opening and 375px mobile screenshots: a real cutout in the red wall and controls without horizontal overflow. Temporary artifacts: `/var/folders/x7/dfgr2r697vj8kb6bg3207nx40000gn/T/exhibitos-geometry-QcGIhn/door-opening.png` and `/var/folders/x7/dfgr2r697vj8kb6bg3207nx40000gn/T/exhibitos-geometry-mobile-Yw37LB/mobile-geometry.png`. Acceptance changes only this evidence and ADR status; product code and tests remain identical to the tested commit. No hosted Actions, paid services or original artwork were used.
