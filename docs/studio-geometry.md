# Studio room, surface and opening editor

Open `/studio`, create or reopen a local draft, then use the space editor. An account is unnecessary for local creation and persistence. Commands modify the same validated OES candidate used by JSON editing, local CAS autosave, backups and remote revision saves. Apply explicitly after changing fields; invalid inputs leave the previous candidate and undo history intact.

A room has meter dimensions and an exhibition-relative rigid transform. A surface is a zero-thickness centered XY rectangle in its room, with normal +Z before rotation. An opening is a centered XY rectangle in a wall. Room and surface scale stays `[1,1,1]`; normalized quaternion fields use XYZW order. The white-cube command creates four walls, a floor and a ceiling in an empty room. It refuses to replace existing surfaces. Changing a room's dimensions does not implicitly reshape its existing surfaces.

Doors either lead outside or form a reciprocal pair between different rooms. Connecting or disconnecting updates both endpoints atomically. Disconnect a paired door before removing it. Referenced rooms, walls or openings cannot be removed while their remaining references would become invalid; remove or adjust references explicitly. Removing an unreferenced surface removes its own material assignment in the same reversible command. Artwork, rights, navigation and unrelated extension metadata are preserved.

Undo and redo retain the latest 20 commands in the current editor session. A new command after undo clears redo. Reopening, JSON replacement, local recovery or explicit remote application starts a new command history; durable local draft history remains available. Offline reload requires the installed public app shell described in [Studio drafts](studio.md).

## Material extension contract

The public base OES schema has no surface PBR fields. Platform stores optional appearance metadata under the valid reverse-DNS extension key `org.exhibitos.studio/materials`. This is a Platform extension, not a new public OES version:

```json
{
  "org.exhibitos.studio/materials": {
    "version": 1,
    "surfaces": {
      "00000000-0000-4000-8000-000000000001": {
        "color": "#f4f1e8",
        "roughness": 0.8,
        "metalness": 0
      }
    }
  }
}
```

`version` and `surfaces` are the only top-level fields; each assignment has exactly the three shown fields. Keys reference existing surface UUIDs, compared case-insensitively, and duplicate case aliases are rejected. There are at most 64 assignments and 16 KiB of serialized extension data. Color is lowercase six-digit hex; roughness and metalness are finite numbers within 0–1. Missing assignments use `#f4f1e8`, roughness 0.8 and metalness 0. Unknown versions fail validation without rewriting data. Both browser persistence and authenticated remote POST/PUT enforce these rules after full public schema and semantic validation. Other namespaces are preserved. No textures or external URLs are fetched. The [machine schema](../contracts/studio-materials.schema.json) describes structural constraints; the shared validator also checks actual surface references and serialized size.

## Preview limits

The local Three.js preview shows room and surface transforms, rectangular wall cutouts and PBR appearance. Keyboard camera controls provide discrete movement with no continuous animation. The selected-face camera views the outward side of a surface so opposite room walls do not obscure its openings. Preview is qualified to 32 rooms, 256 surfaces, 128 openings, 8192 generated rectangular panels and numeric bounds within 10 km. Larger valid documents remain editable as JSON and preserved, with an explicit unavailable-preview message.

This is a geometry inspection view. It does not implement the later artwork-placement editor, Viewer, curved walls, staircases, wall thickness, collision physics or imported mesh rooms. Render material behavior depends on lighting and browser WebGL availability.
