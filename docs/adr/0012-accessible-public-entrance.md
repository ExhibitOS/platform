# ADR 0012: public text entrance before optional 3D

Status: implemented candidate; acceptance evidence pending.

Public metadata and the artwork list render first, without starting a renderer,
physics controller or audio runtime. Explicit 3D activation lazy-mounts Viewer.
Returning to text unmounts Viewer and therefore runs its existing navigation and
audio disposal. Text detail keeps descriptions, translations, dimensions,
rights, provenance, spatial annotations and voice transcripts; it never mounts
the graphics preview or requires playback. No server permission policy changes.

Motion/contrast controls remain available before 3D. Live system media
preferences apply until the visitor overrides them for this page session.
Keyboard dialogs return focus to their opener, skip links expose named list and
settings regions, and an explicit sequential guide follows the publication's
placement list. That ordering does not manufacture an authored spatial route.

Authored viewpoint teleport is a discrete, explicit action. A real controller
must validate floor support and capsule clearance before mutating the visible
camera. The destination leaves walking paused and clears held input; invalid
points preserve the camera. Ordinary orbit viewpoints are distinguished from
physics-validated teleport.

Actual automatic keyboard/ARIA/contrast checks, measured entrance performance,
3D regression and native screen-reader results must be recorded separately.
ARIA snapshots are not VoiceOver execution, a narrow viewport is not physical
mobile hardware, and text performance does not erase existing 3D FPS/RSS limits.
No new dependency or private implementation is required.
