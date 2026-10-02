# ADR0017: optional curation, opt-in zones and readable guided routes

Status: implementation candidate; production-browser qualification pending.

Keep public OES geometry/media/navigation/annotations and existing experience v1
unchanged. The optional `org.exhibitos.viewer/curation` version1 is closed and
bounded: typed audio-zone controls, timed voice transcript cues with separate
translations, annotation translations and ordered descriptions for every base
route waypoint. A complete original voice transcript remains in experience v1;
translations do not replace it. References use exact IDs and each route stop
index resolves the same public navigation waypoint. Unsupported own versions
are rejected at draft/API/publication/OEX boundaries. Prepared WAV duration is
verified against actual PCM frames before public distribution or OEX acceptance.

Runtime uses the AudioContext playback clock, not simulated wall-clock progress.
Voice end, explicit stop, mute, hidden/disposal cancel highlighting. Full original
and translated cues remain readable without audio or graphics. Audio-zone
entry/exit requires a separate explicit opt-in; media integrity/current rights,
limited decoding and current/next-room cache policies remain in force.

Authored inverse-distance gain and straight-line planar occlusion use the same
transformed surfaces/openings as geometry. This is bounded visual/audio feedback,
not measured acoustics, diffraction, speech intelligibility or calibrated levels.
Wet convolution gain remains0..1; closed-wall gain remains0..1. No real artwork,
voice recording, new dependency, paid service or private implementation is needed.

A curated route is voluntarily selected, with previous/next and full readable
stop descriptions, optional artwork details and an explicit 3D stationary view.
Selecting next text never starts walking, grabs pointer lock or starts audio.
Stationary camera views do not certify a safe physical walking route; existing
controller collision/safe viewpoints remain the walking authority. Original
cross-room doorway references are retained on edits, and keyboard focus returns
to the actual route opener. No administrative DB migration is introduced.
