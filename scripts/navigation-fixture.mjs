// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
export function navigationFixture(template, artworks) {
  const doc = structuredClone(template),
    q = [0, 0, 0, 1],
    pose = (position, rotation = q) => ({
      position,
      rotation,
      scale: [1, 1, 1],
    });
  doc.id = randomUUID();
  doc.revisionId = randomUUID();
  doc.artworks = artworks;
  const a = {
      id: randomUUID(),
      name: "Synthetic entrance room",
      dimensions: { width: 8, height: 4, depth: 8 },
      transform: pose([0, 0, 0]),
    },
    b = {
      ...a,
      id: randomUUID(),
      name: "Synthetic adjacent room",
      transform: pose([0, 0, -8]),
    };
  doc.rooms = [a, b];
  const surface = (room, type, width, height, position, rotation = q) => ({
    id: randomUUID(),
    roomId: room.id,
    type,
    dimensions: { width, height },
    transform: pose(position, rotation),
  });
  const floorRotation = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    sideRotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  doc.surfaces = [
    surface(a, "floor", 8, 8, [0, 0, 0], floorRotation),
    surface(b, "floor", 8, 8, [0, 0, 0], floorRotation),
    surface(a, "ceiling", 8, 8, [0, 4, 0], floorRotation),
    surface(b, "ceiling", 8, 8, [0, 4, 0], floorRotation),
  ];
  const partition = surface(a, "wall", 8, 4, [0, 2, -4]);
  doc.surfaces.push(partition);
  for (const room of [a, b]) {
    doc.surfaces.push(
      surface(room, "wall", 8, 4, [-4, 2, 0], sideRotation),
      surface(room, "wall", 8, 4, [4, 2, 0], sideRotation),
    );
  }
  doc.surfaces.push(
    surface(a, "wall", 8, 4, [0, 2, 4]),
    surface(b, "wall", 8, 4, [0, 2, -4]),
  );
  const reciprocal = surface(b, "wall", 8, 4, [0, 2, 4]);
  doc.surfaces.push(reciprocal);
  const firstDoor = randomUUID(),
    secondDoor = randomUUID();
  doc.openings = [
    {
      id: firstDoor,
      connectsToOpeningId: secondDoor,
      surfaceId: partition.id,
      type: "door",
      offset: [0, -0.75],
      dimensions: { width: 1.4, height: 2.5 },
    },
    {
      id: randomUUID(),
      surfaceId: partition.id,
      type: "window",
      offset: [2, 0],
      dimensions: { width: 1.4, height: 0.8 },
    },
  ];
  doc.openings.push(
    {
      id: secondDoor,
      surfaceId: reciprocal.id,
      type: "door",
      offset: [0, -0.75],
      dimensions: { width: 1.4, height: 2.5 },
      connectsToOpeningId: firstDoor,
    },
    {
      id: randomUUID(),
      surfaceId: reciprocal.id,
      type: "window",
      offset: [2, 0],
      dimensions: { width: 1.4, height: 0.8 },
    },
  );
  doc.annotations = [];
  doc.scripts = [];
  doc.audioZones = [];
  const sculpture = artworks.find((a) => a.artworkType === "sculpture"),
    painting = artworks.find((a) => a.artworkType === "image");
  const placement = (art, position, rotation) => ({
    id: randomUUID(),
    roomId: a.id,
    artworkRevisionId: art.revisionId,
    assetId: art.primaryAssetId,
    transform: pose(position, rotation),
  });
  doc.placements = [
    placement(
      sculpture,
      [-2, 0.5, 0],
      [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)],
    ),
    placement(painting, [-3.99, 1.5, 2], sideRotation),
  ];
  doc.lights = [];
  doc.navigation = [];
  doc.accessibility = {
    alternativeView: "list",
    keyboardNavigation: true,
    reducedMotion: true,
    stationaryNavigation: true,
    routeIds: [],
    artworkDescriptions: doc.placements.map((p) => ({
      placementId: p.id,
      text: "Original synthetic navigation obstacle, meter dimensions",
    })),
  };
  doc.extensions = {
    "org.exhibitos.studio/presentation": {
      version: 1,
      startCamera: {
        roomId: a.id,
        position: [0, 1.65, 3],
        target: [0, 1.65, -5],
        fov: 60,
      },
      viewpoints: [],
      credits: "Original synthetic collision and input fixture",
    },
  };
  return {
    document: doc,
    geometry: {
      start: [0, 1.65, 3],
      roomBounds: { x: [-4, 4], z: [-12, 4] },
      door: { center: [0, 1.25, -4], width: 1.4, height: 2.5 },
      window: { center: [2, 2, -4], width: 1.4, height: 0.8 },
      sculpture: {
        center: [-2, 0.5, 0],
        dimensions: [1, 1, 1],
        yaw: Math.PI / 4,
      },
      standingBody: { height: 1.75, radius: 0.25 },
    },
  };
}
