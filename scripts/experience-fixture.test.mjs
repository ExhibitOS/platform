// SPDX-License-Identifier: AGPL-3.0-or-later
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { navigationFixture } from "./navigation-fixture.mjs";
import { addExperience } from "./experience-fixture.mjs";
test("actual navigation fixture alias cannot enlarge first room; larger room preserves floor and reciprocal opening heights", () => {
  // Geometry-only dummy artwork references; actual byte approval is exercised
  // separately by test-experience's PostgreSQL/API integration.
  const artworks = ["sculpture", "image"].map(artworkType => ({ artworkType, revisionId: randomUUID(), primaryAssetId: randomUUID() }));
  const { document } = navigationFixture({}, artworks);
  assert.equal(document.rooms[0].dimensions, document.rooms[1].dimensions, "Regression must exercise actual inherited alias");
  const originalFirst = structuredClone(document.rooms[0]);
  const firstSurfaces = structuredClone(document.surfaces.filter(surface => surface.roomId === originalFirst.id));
  const openingHeights = doc => doc.openings.map(opening => doc.surfaces.find(surface => surface.id === opening.surfaceId).transform.position[1] + opening.offset[1]);
  const originalHeights = openingHeights(document);
  addExperience(document, { id: randomUUID() });
  assert.deepEqual(document.rooms[0], originalFirst);
  assert.deepEqual(document.surfaces.filter(surface => surface.roomId === originalFirst.id), firstSurfaces);
  assert.notEqual(document.rooms[0].dimensions, document.rooms[1].dimensions);
  assert.deepEqual(document.rooms.map(room => room.dimensions.height), [4, 6]);
  assert.deepEqual(document.rooms.map(room => room.dimensions.width * room.dimensions.height * room.dimensions.depth), [256, 384]);
  assert.deepEqual(openingHeights(document), originalHeights);
  const second = document.rooms[1], surfaces = document.surfaces.filter(surface => surface.roomId === second.id);
  for (const surface of surfaces) {
    if (surface.type === "floor") assert.equal(surface.transform.position[1], 0);
    if (surface.type === "ceiling") assert.equal(surface.transform.position[1], 6);
    if (surface.type === "wall") { assert.equal(surface.dimensions.height, 6); assert.equal(surface.transform.position[1], 3); }
  }
});
