// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 ExhibitOS contributors
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import artworkSchema from "@exhibitos/spec/schemas/artwork.json" with { type: "json" };
import exhibitionSchema from "@exhibitos/spec/schemas/exhibition.json" with { type: "json" };
import lifecycleJson from "@exhibitos/spec/schemas/lifecycle.json" with { type: "json" };
import {
  validateArtwork,
  validateRights,
  MAX_ASSET_TOTAL_BYTES,
} from "./artwork-validation.mjs";
export const EXHIBITION_VERSION = "1.0.0-draft.1";
export const HASH_PROFILE = "oes-sorted-json-v1";
const schemas = [artworkSchema, exhibitionSchema, lifecycleJson];
const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  validateFormats: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
addFormats(ajv, ["uuid", "date-time"]);
schemas.forEach((schema) => ajv.addSchema(schema));
const revisionSchema = ajv.getSchema(schemas[1].$id),
  lifecycleSchema = ajv.getSchema(schemas[2].$id);
const utcSchema = ajv.compile(schemas[0].properties.createdAt);
const utf8Length = (value) => new TextEncoder().encode(value).length;
const issue = (code, path, message) => ({ code, path, message });
const result = (errors) => ({
  valid: errors.length === 0,
  errors: errors.slice(0, 100),
});
const key = (id) => id.toLowerCase();
const pointer = (name) => name.replace(/~/g, "~0").replace(/\//g, "~1");
const schemaErrors = (validate) =>
  validate.errors
    .slice(0, 100)
    .map((error) => issue("SCHEMA_INVALID", error.instancePath, error.keyword));

// Bound JSON before schema recursion/hashing; reject values JSON.stringify would silently alter.
function jsonErrors(value) {
  const errors = [],
    active = new Set();
  let nodes = 0;
  function visit(node, path, depth) {
    if (errors.length) return;
    if (++nodes > 100000 || depth > 32) {
      errors.push(
        issue("JSON_LIMIT", path, "JSON tree exceeds depth/node limit"),
      );
      return;
    }
    if (typeof node === "number" && !Number.isFinite(node)) {
      errors.push(issue("NON_JSON_VALUE", path, "Numbers must be finite"));
      return;
    }
    if (typeof node === "string") {
      if (node.length > 16384) {
        errors.push(
          issue("JSON_LIMIT", path, "String exceeds 16384 code units"),
        );
        return;
      }
      for (let i = 0; i < node.length; i++) {
        const unit = node.charCodeAt(i);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const next = node.charCodeAt(++i);
          if (!(next >= 0xdc00 && next <= 0xdfff)) {
            errors.push(issue("NON_JSON_VALUE", path, "Unpaired surrogate"));
            return;
          }
        } else if (unit >= 0xdc00 && unit <= 0xdfff) {
          errors.push(issue("NON_JSON_VALUE", path, "Unpaired surrogate"));
          return;
        }
      }
    } else if (node !== null && typeof node === "object") {
      if (
        active.has(node) ||
        Object.getPrototypeOf(node) !==
          (Array.isArray(node) ? Array.prototype : Object.prototype)
      ) {
        errors.push(
          issue(
            "NON_JSON_VALUE",
            path,
            "Only acyclic plain JSON values are accepted",
          ),
        );
        return;
      }
      if (
        Reflect.ownKeys(node).some(
          (name) =>
            typeof name !== "string" ||
            (Array.isArray(node) && name === "length"
              ? false
              : !Object.getOwnPropertyDescriptor(node, name).enumerable ||
                !("value" in Object.getOwnPropertyDescriptor(node, name))),
        )
      ) {
        errors.push(
          issue(
            "NON_JSON_VALUE",
            path,
            "Only enumerable data properties with string keys are accepted",
          ),
        );
        return;
      }
      if (
        Array.isArray(node) &&
        (Object.keys(node).length !== node.length ||
          Object.keys(node).some((name, index) => name !== String(index)))
      ) {
        errors.push(
          issue(
            "NON_JSON_VALUE",
            path,
            "Arrays must be dense with no extra properties",
          ),
        );
        return;
      }
      active.add(node);
      for (const [name, child] of Object.entries(node)) {
        visit(name, path, depth + 1);
        visit(child, path + "/" + pointer(name), depth + 1);
      }
      active.delete(node);
    } else if (
      !["string", "number", "boolean"].includes(typeof node) &&
      node !== null
    )
      errors.push(
        issue("NON_JSON_VALUE", path, "Only JSON values are accepted"),
      );
  }
  visit(value, "", 0);
  return errors;
}
function sortedJson(value) {
  if (Array.isArray(value)) return "[" + value.map(sortedJson).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((name) => JSON.stringify(name) + ":" + sortedJson(value[name]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function checkTemporal(value, path, errors) {
  if (!Number.isFinite(Date.parse(value)))
    errors.push(
      issue(
        "INVALID_UTC_TIME",
        path,
        "Timestamp must parse to a finite instant",
      ),
    );
}
function checkTransform(transform, path, errors, rigid = false) {
  if (Math.abs(Math.hypot(...transform.rotation) - 1) > 1e-6)
    errors.push(
      issue(
        "QUATERNION_NOT_NORMALIZED",
        path + "/rotation",
        "Quaternion norm must be one within 1e-6",
      ),
    );
  if (rigid && transform.scale.some((n) => n !== 1))
    errors.push(
      issue(
        "NON_RIGID_SPACE",
        path + "/scale",
        "Room, surface and light scale must be identity",
      ),
    );
}
function inside(room, position) {
  return (
    Math.abs(position[0]) <= room.dimensions.width / 2 &&
    position[1] >= 0 &&
    position[1] <= room.dimensions.height &&
    Math.abs(position[2]) <= room.dimensions.depth / 2
  );
}
function registry(items, path, errors) {
  const map = new Map();
  items.forEach((item, index) => {
    if (map.has(key(item.id)))
      errors.push(
        issue(
          "DUPLICATE_ID",
          path + "/" + index + "/id",
          "IDs must be unique in this collection",
        ),
      );
    map.set(key(item.id), item);
  });
  return map;
}
export function assetInventory(revision) {
  const map = new Map();
  for (const asset of [
    ...revision.artworks.flatMap((artwork) => artwork.assets),
    ...revision.mediaAssets,
  ])
    map.set(key(asset.id), {
      id: asset.id,
      path: asset.path,
      bytes: asset.bytes,
      sha256: asset.sha256,
    });
  return [...map.values()].sort((a, b) =>
    key(a.id) < key(b.id) ? -1 : key(a.id) > key(b.id) ? 1 : 0,
  );
}
export function validateExhibition(revision, { publicationTime } = {}) {
  const safety = jsonErrors(revision);
  if (safety.length) return result(safety);
  if (revision?.schemaVersion !== EXHIBITION_VERSION)
    return result([
      issue(
        "UNSUPPORTED_VERSION",
        "/schemaVersion",
        "Expected " + EXHIBITION_VERSION,
      ),
    ]);
  if (!revisionSchema(revision)) return result(schemaErrors(revisionSchema));
  if (utf8Length(sortedJson(revision)) > 1048576)
    return result([issue("DOCUMENT_LIMIT", "", "Revision exceeds 1MiB")]);
  const errors = [];
  if (
    publicationTime !== undefined &&
    (!utcSchema(publicationTime) ||
      !Number.isFinite(Date.parse(publicationTime)))
  )
    errors.push(
      issue(
        "INVALID_PUBLICATION_TIME",
        "/publicationTime",
        "Publication time must match the restricted UTC profile",
      ),
    );
  checkTemporal(revision.createdAt, "/createdAt", errors);
  const maps = {};
  for (const name of [
    "rooms",
    "surfaces",
    "openings",
    "placements",
    "lights",
    "navigation",
    "mediaAssets",
    "audioZones",
    "annotations",
    "scripts",
  ])
    maps[name] = registry(revision[name], "/" + name, errors);
  const artworks = new Map(),
    allAssets = new Map(),
    paths = new Map();
  revision.artworks.forEach((artwork, index) => {
    if (artworks.has(key(artwork.revisionId)))
      errors.push(
        issue(
          "DUPLICATE_ARTWORK_REVISION",
          `/artworks/${index}/revisionId`,
          "Artwork revision IDs must be unique",
        ),
      );
    artworks.set(key(artwork.revisionId), artwork);
    const checked = validateArtwork(artwork, { publicationTime });
    errors.push(
      ...checked.errors.map((error) => ({
        ...error,
        path: `/artworks/${index}` + error.path,
      })),
    );
  });
  for (const asset of [
    ...revision.artworks.flatMap((artwork) => artwork.assets),
    ...revision.mediaAssets,
  ]) {
    const signature = JSON.stringify([
      asset.path,
      asset.bytes,
      asset.sha256,
      asset.mime,
    ]);
    if (
      allAssets.has(key(asset.id)) &&
      allAssets.get(key(asset.id)).signature !== signature
    )
      errors.push(
        issue(
          "ASSET_ID_CONFLICT",
          "/artworks",
          "Same asset ID must retain one exact file descriptor",
        ),
      );
    if (paths.has(asset.path) && paths.get(asset.path) !== signature)
      errors.push(
        issue(
          "ASSET_PATH_CONFLICT",
          "/artworks",
          "One path must retain one exact file descriptor",
        ),
      );
    allAssets.set(key(asset.id), { signature, asset });
    paths.set(asset.path, signature);
  }
  if (
    assetInventory(revision).reduce((sum, asset) => sum + asset.bytes, 0) >
    MAX_ASSET_TOTAL_BYTES
  )
    errors.push(
      issue("ASSET_TOTAL_LIMIT", "/artworks", "Unique assets exceed 256MiB"),
    );
  revision.rooms.forEach((room, i) =>
    checkTransform(room.transform, `/rooms/${i}/transform`, errors, true),
  );
  revision.surfaces.forEach((surface, i) => {
    const room = maps.rooms.get(key(surface.roomId));
    if (!room)
      errors.push(
        issue(
          "MISSING_ROOM",
          `/surfaces/${i}/roomId`,
          "Surface room must resolve",
        ),
      );
    else if (!inside(room, surface.transform.position))
      errors.push(
        issue(
          "POSITION_OUTSIDE_ROOM",
          `/surfaces/${i}/transform/position`,
          "Surface center must be inside its room",
        ),
      );
    checkTransform(surface.transform, `/surfaces/${i}/transform`, errors, true);
  });
  const openingRoom = (opening) => {
    const surface = maps.surfaces.get(key(opening.surfaceId));
    return surface ? maps.rooms.get(key(surface.roomId)) : undefined;
  };
  revision.openings.forEach((opening, i) => {
    const path = `/openings/${i}`,
      surface = maps.surfaces.get(key(opening.surfaceId));
    if (!surface)
      errors.push(
        issue(
          "MISSING_SURFACE",
          path + "/surfaceId",
          "Opening surface must resolve",
        ),
      );
    else {
      if (surface.type !== "wall")
        errors.push(
          issue(
            "OPENING_SURFACE_TYPE",
            path + "/surfaceId",
            "Doors and windows require a wall surface",
          ),
        );
      if (
        Math.abs(opening.offset[0]) + opening.dimensions.width / 2 >
          surface.dimensions.width / 2 ||
        Math.abs(opening.offset[1]) + opening.dimensions.height / 2 >
          surface.dimensions.height / 2
      )
        errors.push(
          issue(
            "OPENING_OUTSIDE_SURFACE",
            path,
            "Opening rectangle must fit its surface",
          ),
        );
    }
    if (opening.type === "window") {
      if (
        opening.connectsToOpeningId !== undefined ||
        opening.exterior !== undefined
      )
        errors.push(
          issue(
            "WINDOW_CONNECTION",
            path,
            "Windows cannot carry door graph endpoints",
          ),
        );
      return;
    }
    if (
      (opening.connectsToOpeningId !== undefined) ===
      (opening.exterior === true)
    )
      errors.push(
        issue(
          "DOOR_ENDPOINT_REQUIRED",
          path,
          "Door needs exactly one reciprocal endpoint or exterior=true",
        ),
      );
    if (opening.connectsToOpeningId !== undefined) {
      const target = maps.openings.get(key(opening.connectsToOpeningId));
      if (!target || target.type !== "door")
        errors.push(
          issue(
            "DANGLING_DOOR",
            path + "/connectsToOpeningId",
            "Door endpoint must resolve to a door",
          ),
        );
      else if (
        key(target.id) === key(opening.id) ||
        !target.connectsToOpeningId ||
        key(target.connectsToOpeningId) !== key(opening.id) ||
        target.exterior === true
      )
        errors.push(
          issue(
            "NON_RECIPROCAL_DOOR",
            path,
            "Door endpoints must connect reciprocally",
          ),
        );
      else {
        const sourceRoom = openingRoom(opening),
          targetRoom = openingRoom(target);
        if (
          sourceRoom &&
          targetRoom &&
          key(sourceRoom.id) === key(targetRoom.id)
        )
          errors.push(
            issue(
              "DOOR_SAME_ROOM",
              path,
              "Connected door endpoints must belong to different rooms",
            ),
          );
      }
    }
  });
  revision.placements.forEach((placement, i) => {
    const path = `/placements/${i}`,
      room = maps.rooms.get(key(placement.roomId)),
      artwork = artworks.get(key(placement.artworkRevisionId));
    if (!room)
      errors.push(
        issue("MISSING_ROOM", path + "/roomId", "Placement room must resolve"),
      );
    else if (!inside(room, placement.transform.position))
      errors.push(
        issue(
          "POSITION_OUTSIDE_ROOM",
          path + "/transform/position",
          "Placement origin must be in its room",
        ),
      );
    if (!artwork)
      errors.push(
        issue(
          "MISSING_ARTWORK_REVISION",
          path + "/artworkRevisionId",
          "Placement must reference an embedded artwork snapshot",
        ),
      );
    else if (
      !artwork.assets.some(
        (asset) =>
          key(asset.id) === key(placement.assetId) &&
          asset.role ===
            (artwork.artworkType === "sculpture" ? "model" : "image"),
      )
    )
      errors.push(
        issue(
          "MISSING_PLACEMENT_ASSET",
          path + "/assetId",
          "Placement display asset must belong to that artwork revision",
        ),
      );
    checkTransform(placement.transform, path + "/transform", errors);
  });
  revision.lights.forEach((light, i) => {
    const path = `/lights/${i}`,
      room = maps.rooms.get(key(light.roomId));
    if (!room)
      errors.push(
        issue("MISSING_ROOM", path + "/roomId", "Light room must resolve"),
      );
    else if (!inside(room, light.transform.position))
      errors.push(
        issue(
          "POSITION_OUTSIDE_ROOM",
          path + "/transform/position",
          "Light origin must be in its room",
        ),
      );
    checkTransform(light.transform, path + "/transform", errors, true);
    if (
      light.unit !==
      { point: "candela", spot: "candela", directional: "lux", area: "lumen" }[
        light.type
      ]
    )
      errors.push(
        issue(
          "LIGHT_UNIT",
          path + "/unit",
          "Intensity unit must match light type",
        ),
      );
    if (
      (light.type === "spot") !== (light.beamAngle !== undefined) ||
      (light.type === "area") !== (light.dimensions !== undefined)
    )
      errors.push(
        issue(
          "LIGHT_PARAMETERS",
          path,
          "Spot requires beamAngle; area requires dimensions; other types omit them",
        ),
      );
    if (light.targetPlacementId !== undefined) {
      const placement = maps.placements.get(key(light.targetPlacementId));
      if (!placement || key(placement.roomId) !== key(light.roomId))
        errors.push(
          issue(
            "MISSING_LIGHT_TARGET",
            path + "/targetPlacementId",
            "Target placement must exist in the same room",
          ),
        );
    }
  });
  revision.navigation.forEach((route, i) =>
    route.waypoints.forEach((point, j) => {
      const path = `/navigation/${i}/waypoints/${j}`,
        room = maps.rooms.get(key(point.roomId));
      if (!room)
        errors.push(
          issue("MISSING_ROOM", path + "/roomId", "Waypoint room must resolve"),
        );
      else if (!inside(room, point.position))
        errors.push(
          issue(
            "POSITION_OUTSIDE_ROOM",
            path + "/position",
            "Waypoint must be in its room",
          ),
        );
      const previous = route.waypoints[j - 1],
        changedRoom = previous && key(previous.roomId) !== key(point.roomId);
      if (!changedRoom && point.viaOpeningId !== undefined)
        errors.push(
          issue(
            "UNEXPECTED_ROUTE_DOOR",
            path + "/viaOpeningId",
            "Door crossing is only used for a room transition",
          ),
        );
      if (changedRoom) {
        const source = point.viaOpeningId
            ? maps.openings.get(key(point.viaOpeningId))
            : undefined,
          target = source?.connectsToOpeningId
            ? maps.openings.get(key(source.connectsToOpeningId))
            : undefined;
        const from = source ? openingRoom(source) : undefined,
          to = target ? openingRoom(target) : undefined;
        if (
          !source ||
          source.type !== "door" ||
          !target ||
          target.type !== "door" ||
          !from ||
          !to ||
          key(from.id) !== key(previous.roomId) ||
          key(to.id) !== key(point.roomId)
        )
          errors.push(
            issue(
              "INVALID_ROUTE_DOOR",
              path + "/viaOpeningId",
              "Room transition needs its reciprocal door graph edge",
            ),
          );
      }
    }),
  );
  const descriptions = new Set();
  revision.accessibility.artworkDescriptions.forEach((description, i) => {
    if (!maps.placements.has(key(description.placementId)))
      errors.push(
        issue(
          "MISSING_ACCESSIBILITY_PLACEMENT",
          `/accessibility/artworkDescriptions/${i}/placementId`,
          "Description must reference a placement",
        ),
      );
    if (descriptions.has(key(description.placementId)))
      errors.push(
        issue(
          "DUPLICATE_ACCESSIBILITY_DESCRIPTION",
          "/accessibility/artworkDescriptions",
          "One description per placement",
        ),
      );
    descriptions.add(key(description.placementId));
  });
  revision.placements.forEach((placement) => {
    if (!descriptions.has(key(placement.id)))
      errors.push(
        issue(
          "MISSING_ACCESSIBILITY_DESCRIPTION",
          "/accessibility/artworkDescriptions",
          "Every placement needs a plain-text alternative",
        ),
      );
  });
  const routeIds = new Set();
  revision.accessibility.routeIds.forEach((id, i) => {
    const route = maps.navigation.get(key(id));
    if (!route || !route.accessible)
      errors.push(
        issue(
          "MISSING_ACCESSIBLE_ROUTE",
          `/accessibility/routeIds/${i}`,
          "Accessibility route must resolve to an accessible route",
        ),
      );
    if (routeIds.has(key(id)))
      errors.push(
        issue(
          "DUPLICATE_ACCESSIBILITY_ROUTE",
          "/accessibility/routeIds",
          "Route IDs must be unique",
        ),
      );
    routeIds.add(key(id));
  });
  revision.mediaAssets.forEach((asset, i) => {
    const suffix = {
      "audio/mpeg": ".mp3",
      "audio/ogg": ".ogg",
      "audio/wav": ".wav",
    }[asset.mime];
    if (!asset.path.endsWith(suffix))
      errors.push(
        issue(
          "ASSET_EXTENSION_MISMATCH",
          `/mediaAssets/${i}/path`,
          "Audio suffix must match MIME",
        ),
      );
    const checked = validateRights(asset.rights, { publicationTime });
    errors.push(
      ...checked.errors.map((error) => ({
        ...error,
        path: `/mediaAssets/${i}` + error.path,
      })),
    );
  });
  revision.audioZones.forEach((zone, i) => {
    const room = maps.rooms.get(key(zone.roomId));
    if (!room)
      errors.push(
        issue(
          "MISSING_ROOM",
          `/audioZones/${i}/roomId`,
          "Audio room must resolve",
        ),
      );
    else if (!inside(room, zone.position))
      errors.push(
        issue(
          "POSITION_OUTSIDE_ROOM",
          `/audioZones/${i}/position`,
          "Audio zone center must be in its room",
        ),
      );
    if (!maps.mediaAssets.has(key(zone.assetId)))
      errors.push(
        issue(
          "MISSING_AUDIO_ASSET",
          `/audioZones/${i}/assetId`,
          "Audio asset must resolve",
        ),
      );
  });
  revision.annotations.forEach((annotation, i) => {
    if (!maps.placements.has(key(annotation.placementId)))
      errors.push(
        issue(
          "MISSING_ANNOTATION_PLACEMENT",
          `/annotations/${i}/placementId`,
          "Annotation placement must resolve",
        ),
      );
  });
  revision.scripts.forEach((script, i) => {
    const path = `/scripts/${i}`;
    if (
      script.trigger.type === "room-enter"
        ? !script.trigger.roomId || !maps.rooms.has(key(script.trigger.roomId))
        : script.trigger.roomId !== undefined
    )
      errors.push(
        issue(
          "SCRIPT_TRIGGER_REFERENCE",
          path + "/trigger",
          "Room trigger needs a valid room; start trigger omits room",
        ),
      );
    script.actions.forEach((action, j) => {
      const targetMap = {
        "set-light-intensity": maps.lights,
        "show-annotation": maps.annotations,
        "play-audio": maps.audioZones,
      }[action.type];
      if (!targetMap.has(key(action.targetId)))
        errors.push(
          issue(
            "SCRIPT_ACTION_REFERENCE",
            `${path}/actions/${j}/targetId`,
            "Typed target must resolve",
          ),
        );
      if (
        (action.type === "set-light-intensity") !==
        (action.value !== undefined)
      )
        errors.push(
          issue(
            "SCRIPT_ACTION_VALUE",
            `${path}/actions/${j}`,
            "Only light intensity actions require a value",
          ),
        );
    });
  });
  if (
    revision.scripts.reduce((sum, script) => sum + script.actions.length, 0) >
    1024
  )
    errors.push(
      issue(
        "SCRIPT_ACTION_LIMIT",
        "/scripts",
        "Maximum 1024 stored actions per exhibition",
      ),
    );
  for (const [path, extensions] of [
    ["/extensions", revision.extensions],
    ...revision.artworks.map((artwork, i) => [
      `/artworks/${i}/extensions`,
      artwork.extensions,
    ]),
  ])
    if (extensions)
      for (const [name, value] of Object.entries(extensions))
        if (utf8Length(sortedJson(value)) > 16384)
          errors.push(
            issue(
              "EXTENSION_LIMIT",
              path + "/" + pointer(name),
              "Each extension is at most 16KiB",
            ),
          );
  return result(errors);
}
export function validateLifecycle(document) {
  const safety = jsonErrors(document);
  if (safety.length) return result(safety);
  if (document?.schemaVersion !== EXHIBITION_VERSION)
    return result([
      issue(
        "UNSUPPORTED_VERSION",
        "/schemaVersion",
        "Expected " + EXHIBITION_VERSION,
      ),
    ]);
  if (!lifecycleSchema(document)) return result(schemaErrors(lifecycleSchema));
  if (utf8Length(sortedJson(document)) > 1048576)
    return result([
      issue("DOCUMENT_LIMIT", "", "Lifecycle document exceeds 1MiB"),
    ]);
  const errors = [];
  for (const field of [
    "createdAt",
    "updatedAt",
    "publishedAt",
    "unpublishedAt",
    "frozenAt",
  ])
    if (document[field] !== undefined)
      checkTemporal(document[field], "/" + field, errors);
  if (document.kind === "exhibition-draft") {
    const checked = validateExhibition(document.candidate);
    errors.push(
      ...checked.errors.map((error) => ({
        ...error,
        path: "/candidate" + error.path,
      })),
    );
    if (key(document.exhibitionId) !== key(document.candidate.id))
      errors.push(
        issue(
          "EXHIBITION_ID_MISMATCH",
          "/exhibitionId",
          "Candidate must belong to draft exhibition",
        ),
      );
    if (Date.parse(document.updatedAt) < Date.parse(document.createdAt))
      errors.push(
        issue(
          "DRAFT_TIME_RANGE",
          "/updatedAt",
          "updatedAt must follow createdAt",
        ),
      );
    return result(errors);
  }
  return result([
    issue("DRAFT_REQUIRED", "", "Only authoring drafts are supported here"),
  ]);
}
