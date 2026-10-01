import type { Draft } from "./validator.js";

export function newDraft(title = "새 전시"): Draft {
  const time = new Date().toISOString();
  const exhibitionId = crypto.randomUUID();
  return {
    schemaVersion: "1.0.0-draft.1",
    kind: "exhibition-draft",
    id: crypto.randomUUID(),
    exhibitionId,
    editVersion: 1,
    createdAt: time,
    updatedAt: time,
    candidate: {
      schemaVersion: "1.0.0-draft.1",
      kind: "exhibition-revision",
      id: exhibitionId,
      revisionId: crypto.randomUUID(),
      revision: 1,
      createdAt: time,
      title,
      units: "meter",
      coordinates: "right-handed-y-up",
      rooms: [
        {
          id: crypto.randomUUID(),
          name: "첫 공간",
          dimensions: { width: 12, height: 4, depth: 8 },
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
        },
      ],
      surfaces: [],
      openings: [],
      artworks: [],
      placements: [],
      lights: [],
      navigation: [],
      accessibility: {
        alternativeView: "list",
        keyboardNavigation: true,
        reducedMotion: true,
        stationaryNavigation: true,
        routeIds: [],
        artworkDescriptions: [],
      },
      mediaAssets: [],
      audioZones: [],
      annotations: [],
      scripts: [],
    },
  };
}
