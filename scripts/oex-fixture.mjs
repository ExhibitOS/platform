// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { navigationFixture } from "./navigation-fixture.mjs";
import { addExperience } from "./experience-fixture.mjs";

/** Rich original scene exercises typed references and opaque UUID-looking prose. */
export function oexFixture(template, artworks, mediaAsset) {
  const { document } = navigationFixture(template, artworks);
  document.title = "Synthetic OEX preservation exhibition";
  addExperience(document, mediaAsset);
  const route = { id: randomUUID(), name: "Synthetic authored accessible route", accessible: true,
    waypoints: document.rooms.map((room, index) => ({ roomId: room.id, position: [0, 1.65, 1],
      ...(index ? { viaOpeningId: document.openings.find(opening => opening.type === "door").id } : {}) })) };
  document.navigation = [route];
  document.accessibility.routeIds = [route.id];
  document.lights = document.rooms.map(room => ({ id: randomUUID(), roomId: room.id, type: "point",
    transform: { position: [1, 3, 1], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    color: [1, .8, .7], intensity: 100, unit: "candela", castsShadow: false }));
  document.extensions["org.exhibitos.studio/materials"] = { version: 1,
    surfaces: Object.fromEntries(document.surfaces.map((surface, index) => [surface.id,
      { color: index % 2 ? "#aabbcc" : "#fefefe", roughness: .6, metalness: .1 }])) };
  document.extensions["org.exhibitos.studio/presentation"].viewpoints = document.rooms.map(room => ({
    id: randomUUID(), name: `Viewpoint ${room.name}`, roomId: room.id,
    position: [0, 1.65, 1], target: [0, 1.65, -1], fov: 55 }));
  document.extensions["org.exhibitos.studio/presentation"].credits = `Literal original room identifier ${document.rooms[0].id}; preserve this prose exactly.`;
  document.annotations[0].text += ` Literal ${document.rooms[0].id} is prose, not a reference.`;
  document.scripts = [{ id: randomUUID(), enabled: false,
    trigger: { type: "room-enter", roomId: document.rooms[0].id },
    actions: [{ type: "show-annotation", targetId: document.annotations[0].id, delayMs: 0 }] }];
  const at = new Date().toISOString();
  return { schemaVersion: "1.0.0-draft.1", kind: "exhibition-draft", id: randomUUID(),
    exhibitionId: document.id, editVersion: 1, createdAt: at, updatedAt: at, candidate: document };
}
