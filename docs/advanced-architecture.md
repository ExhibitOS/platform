# Advanced architecture and template profile

Studio's advanced architecture section generates ordinary OES room-local
rectangular surfaces. Existing room, surface and opening editors remain the
editable source of truth; no private implementation or new public base schema
is required. Each successful addition or template application is one validated,
undoable transition and uses existing IndexedDB CAS saving and server revisions.

Curved walls are explicit chord segments (2–32) with a chosen radius, sweep and
height. They are faceted, not analytic curved surfaces. Stairs generate tread
floors and vertical riser walls (rise at most 0.25 m, tread at least 0.3 m).
Ramps are continuous inclined floors, width at least 1 m and gradient at most
1:12. Generation begins at the selected room's local origin; move, rotate,
resize or remove individual planes using the surface editor. Connect rooms
using the existing reciprocal door command. Windows remain true rectangular
wall cutouts with their actual sill and head clearance. The same persisted
planes drive Three.js rendering and Rapier collision. An enabled stair command
is not a guarantee of a collision-free route: the final arrangement, landing,
body clearance and doors must be checked in Viewer. Stairs alone are not an
accessible route. The 1:12 generation limit does not certify compliance with any
building/accessibility standard; use a separately connected route and the list
and stationary navigation alternatives.

## Visual lighting

`org.exhibitos.studio/daylight` version 1 stores a Gregorian date, solar hour
0–24, latitude −90–90°, north rotation 0–360°, intensity 0–5 and enabled flag.
Renderer direction uses a bounded seasonal solar declination approximation;
light is off below the horizon or when disabled. This is a visual direction
control. It does not model civil timezone, longitude, weather, glazing,
window transmission, physically accurate indoor irradiance, lux or energy use.
Window location, orientation and size remain editable geometry. The placement panel supplies point/spot/directional/rectangular area light
controls, correct stored candela/lux/lumen units, area dimensions and a bounded
1000–20000 K visual color approximation. Area light power maps to the renderer
lumen property. RectAreaLight has no shadow support; no physical light
measurement, calibrated spectrum or shadow qualification is claimed.
Implementation follows the official [Three.js area-light documentation](https://threejs.org/docs/pages/RectAreaLight.html).
Renderer profile bounds light intensity to0..1e6, positions to±10000m and
area dimensions to0.01..100m so lumen conversion never overflows GPU uniforms.
Values outside this profile fail server/client validation; the public base
schema is unchanged.
Its LTC lookup data retains the original upstream license and paper citation
in the production notices artifact.

## Templates and rights

The built-in connected two-room gallery is wholly synthetic. Its geometry is
provided as CC0-1.0 by ExhibitOS contributors; no artwork bytes are included.
Duplicate it into an empty draft, customize rooms/planes/openings/lighting,
save locally or to the authenticated server and explicitly publish a READY
revision using the ordinary Studio workflow. Template JSON download/import is
bounded to 256 KiB. Downloaded templates contain an exhibition geometry document,
not an OEX package or database backup. Ordinary Studio JSON backup is unchanged.

Machine-readable extension value definitions are in [studio-architecture.schema.json](../contracts/studio-architecture.schema.json); shared semantic validation additionally checks dates, safe source URLs and redistribution rights.

`org.exhibitos.studio/template` version 1 requires name, creator, license,
source, modified flag and `profile: "oes-rectangles-v1"`. Supported redistribution
licenses are CC0-1.0 and CC-BY-4.0; explicit `private` allows local editing but
blocks template download, anonymous publication and OEX export on the server.
A missing or unknown license is rejected on template import. No license is
inferred for community submissions. CC-BY attribution/source is retained;
customization marks the template modified without replacing its creator/license.
Only claim CC0 for geometry whose rights you own. The local author declaration
is explicit; it does not clear third-party rights or change imported attribution.

The import profile allows only daylight/template/material/presentation
extensions, and rejects artwork, placements, media, audio zones, scripts and
annotations. Unsupported/private extensions must be explicitly removed before
submission. Applying a template refuses drafts containing artwork, media,
audio, scripts or annotations rather than silently discarding them. Geometry
replacement can be undone and existing durable draft history is retained.
IDs and supported references are regenerated for the duplicate while target
exhibition identity is preserved. Attribution text renders as text, no HTML or
remote fetch is executed. HTTPS source URLs may not contain credentials, query
parameters or fragments; bundled source identifiers are also supported.

Other base OES consumers can render and collide with the generated planes.
Consumers that do not implement the optional daylight extension use their own
lighting. Anonymous publication and the OEX profile explicitly preserve and
validate these two extensions. Unknown versions fail closed. Existing fixtures
without them keep their prior lighting and validation behavior. No DB migration
is required because complete geometry and extension documents already reside in
immutable Studio/publication revisions.

## Qualification

`npm run check` and `npm run test:e2e` are the common build gates.
`npm run test:geometry` exercises actual production Chromium, IndexedDB,
template duplicate/customize/download/import and a real service-worker offline
reload. `npm run test:publication` exercises the authenticated API with actual
isolated PostgreSQL, publication projection and private-license READY denial.
`apps/web/src/geometry/advanced.test.ts` uses real Rapier for generated curve
collision, stairs/ramp support and connected doors versus an elevated window
sill. These are synthetic local checks, not physical-device qualification or
architectural certification. Frozen source `7da52c6203c47e1c77e0d7a87dd6cd00413c243a` passed local
qualification on 2026-10-02: 151 unit tests, 9 contract cases, type/lint/build,
3 baseline E2E cases and 6 production geometry browser groups. An independent
fresh archive installed the pinned dependencies, built production outputs and
passed 16 actual isolated PostgreSQL/API, publication-browser and database
backup/restore groups at 19:52:43 UTC. The public GLB/PNG canvas contained
14,136 colored derivative pixels with its original camera and strict pixel
assertion retained. The template was duplicated, customized with curved walls
and stairs in its second room, saved/reloaded, published and checked through the
anonymous immutable projection; explicit private licensing blocked a direct
publication request on the server. The synthetic fixture keeps first-room
artwork sightlines clear rather than removing geometry or weakening the visual
assertion. Actual Rapier cases qualify stair ascent, ramp support, curved-wall
collision, level connected-door routing and elevated-window passage rejection.
A vertical accessible ramp route graph has not been qualified; these checks
do not certify an entire authored arrangement or accessibility compliance.
This is development-branch qualification, not a main-branch or device release.

Draft editor sibling keys are namespaced by component role and draft identity.
Switching drafts therefore removes the prior geometry/experience editor instead
of retaining an orphaned DOM section with stale commands. Deferred template
reads also require the same mounted, enabled draft and latest import request
before they may apply; edits, unmounts and later selections cancel stale reads.
