// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from "@exhibitos/spec";
import {
  MATERIAL_NAMESPACE,
  type PbrMaterial,
  type StudioMaterials,
} from "@exhibitos/studio-contract";
import { validateDraft } from "../drafts/validator";
export type Room = Exhibition["rooms"][number];
export type Surface = Exhibition["surfaces"][number];
export type Opening = Exhibition["openings"][number];
export type Pose = Room["transform"];
export interface GeometryState {
  present: Exhibition;
  past: Exhibition[];
  future: Exhibition[];
}
export type GeometryCommand =
  | { type: "add-room"; room: Room }
  | { type: "set-room"; id: string; room: Omit<Room, "id"> }
  | { type: "white-cube"; roomId: string }
  | { type: "add-surface"; surface: Surface }
  | { type: "set-surface"; id: string; surface: Omit<Surface, "id"> }
  | { type: "add-opening"; opening: Opening }
  | { type: "set-opening"; id: string; opening: Omit<Opening, "id"> }
  | { type: "set-material"; surfaceId: string; material: PbrMaterial | null }
  | { type: "remove-room" | "remove-surface" | "remove-opening"; id: string }
  | { type: "connect-doors"; firstId: string; secondId: string }
  | { type: "disconnect-door"; id: string };
export class GeometryError extends Error {
  constructor(
    public code: string,
    public issues: unknown = [],
  ) {
    super(code);
    this.name = "GeometryError";
  }
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const clone = <T>(v: T): T => structuredClone(v);
const identity = (): Pose => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});
export function newRoom(
  name: string,
  dimensions: Room["dimensions"],
  transform: Pose = identity(),
): Room {
  return {
    id: crypto.randomUUID(),
    name,
    dimensions: clone(dimensions),
    transform: clone(transform),
  };
}
export function newSurface(
  roomId: string,
  type: Surface["type"],
  dimensions: Surface["dimensions"],
  transform: Pose,
): Surface {
  return {
    id: crypto.randomUUID(),
    roomId,
    type,
    dimensions: clone(dimensions),
    transform: clone(transform),
  };
}
export function newDoor(
  surfaceId: string,
  dimensions: Opening["dimensions"],
  offset: Opening["offset"],
): Opening {
  return {
    id: crypto.randomUUID(),
    surfaceId,
    type: "door",
    dimensions: clone(dimensions),
    offset: clone(offset),
    exterior: true,
  };
}
export function whiteCubeSurfaces(room: Room): Surface[] {
  const { width: w, height: h, depth: d } = room.dimensions,
    q = Math.SQRT1_2;
  const surface = (
    type: Surface["type"],
    width: number,
    height: number,
    position: Pose["position"],
    rotation: Pose["rotation"],
  ) =>
    newSurface(
      room.id,
      type,
      { width, height },
      { position, rotation, scale: [1, 1, 1] },
    );
  return [
    surface("wall", w, h, [0, h / 2, -d / 2], [0, 0, 0, 1]),
    surface("wall", w, h, [0, h / 2, d / 2], [0, 1, 0, 0]),
    surface("wall", d, h, [-w / 2, h / 2, 0], [0, q, 0, q]),
    surface("wall", d, h, [w / 2, h / 2, 0], [0, -q, 0, q]),
    surface("floor", w, d, [0, 0, 0], [-q, 0, 0, q]),
    surface("ceiling", w, d, [0, h, 0], [q, 0, 0, q]),
  ];
}
function checked(candidate: Exhibition): void {
  const time = "2026-01-01T00:00:00.000Z";
  const validation = validateDraft({
    schemaVersion: "1.0.0-draft.1",
    kind: "exhibition-draft",
    id: candidate.revisionId,
    exhibitionId: candidate.id,
    editVersion: 1,
    createdAt: time,
    updatedAt: time,
    candidate,
  });
  if (!validation.valid)
    throw new GeometryError("INVALID_GEOMETRY", validation.errors);
}
export function createGeometryState(candidate: Exhibition): GeometryState {
  checked(candidate);
  return { present: clone(candidate), past: [], future: [] };
}
function find<T extends { id: string }>(items: T[], id: string): T {
  const v = items.find((item) => same(item.id, id));
  if (!v) throw new GeometryError("ELEMENT_NOT_FOUND");
  return v;
}
function replace<T extends { id: string }>(
  items: T[],
  id: string,
  value: Omit<T, "id">,
): void {
  const v = find(items, id);
  items[items.indexOf(v)] = { ...clone(value), id: v.id } as T;
}
function materialMap(doc: Exhibition): StudioMaterials {
  return clone(
    (doc.extensions?.[MATERIAL_NAMESPACE] as unknown as
      StudioMaterials | undefined) ?? { version: 1, surfaces: {} },
  );
}
function setMap(doc: Exhibition, map: StudioMaterials): void {
  doc.extensions = {
    ...doc.extensions,
    [MATERIAL_NAMESPACE]: map as unknown as NonNullable<
      Exhibition["extensions"]
    >[string],
  };
}
export function applyGeometryCommand(
  state: GeometryState,
  command: GeometryCommand,
): GeometryState {
  const doc = clone(state.present);
  switch (command.type) {
    case "add-room":
      doc.rooms.push(clone(command.room));
      break;
    case "set-room":
      replace(doc.rooms, command.id, command.room);
      break;
    case "white-cube": {
      const room = find(doc.rooms, command.roomId);
      if (doc.surfaces.some((s) => same(s.roomId, room.id)))
        throw new GeometryError("ROOM_HAS_SURFACES");
      doc.surfaces.push(...whiteCubeSurfaces(room));
      break;
    }
    case "add-surface":
      doc.surfaces.push(clone(command.surface));
      break;
    case "set-surface":
      replace(doc.surfaces, command.id, command.surface);
      break;
    case "add-opening":
      doc.openings.push(clone(command.opening));
      break;
    case "set-opening":
      replace(doc.openings, command.id, command.opening);
      break;
    case "set-material": {
      const surface = find(doc.surfaces, command.surfaceId),
        map = materialMap(doc);
      for (const key of Object.keys(map.surfaces))
        if (same(key, surface.id)) delete map.surfaces[key];
      if (command.material) map.surfaces[surface.id] = clone(command.material);
      setMap(doc, map);
      break;
    }
    case "remove-room": {
      find(doc.rooms, command.id);
      doc.rooms = doc.rooms.filter((r) => !same(r.id, command.id));
      break;
    }
    case "remove-surface": {
      find(doc.surfaces, command.id);
      doc.surfaces = doc.surfaces.filter((s) => !same(s.id, command.id));
      if (doc.extensions?.[MATERIAL_NAMESPACE]) {
        const map = materialMap(doc);
        for (const key of Object.keys(map.surfaces))
          if (same(key, command.id)) delete map.surfaces[key];
        setMap(doc, map);
      }
      break;
    }
    case "remove-opening": {
      const opening = find(doc.openings, command.id);
      if (opening.connectsToOpeningId)
        throw new GeometryError("DOOR_CONNECTED");
      doc.openings = doc.openings.filter((o) => !same(o.id, command.id));
      break;
    }
    case "connect-doors": {
      const first = find(doc.openings, command.firstId),
        second = find(doc.openings, command.secondId);
      if (
        first.type !== "door" ||
        second.type !== "door" ||
        same(first.id, second.id) ||
        first.connectsToOpeningId ||
        second.connectsToOpeningId ||
        same(
          find(doc.surfaces, first.surfaceId).roomId,
          find(doc.surfaces, second.surfaceId).roomId,
        )
      )
        throw new GeometryError("DOOR_CONNECTION_INVALID");
      first.connectsToOpeningId = second.id;
      second.connectsToOpeningId = first.id;
      delete first.exterior;
      delete second.exterior;
      break;
    }
    case "disconnect-door": {
      const door = find(doc.openings, command.id);
      if (door.type !== "door") throw new GeometryError("NOT_A_DOOR");
      if (door.connectsToOpeningId) {
        const other = find(doc.openings, door.connectsToOpeningId);
        delete other.connectsToOpeningId;
        other.exterior = true;
      }
      delete door.connectsToOpeningId;
      door.exterior = true;
      break;
    }
  }
  checked(doc);
  return {
    present: doc,
    past: [...state.past, clone(state.present)].slice(-20),
    future: [],
  };
}
export function undoGeometry(state: GeometryState): GeometryState {
  const previous = state.past.at(-1);
  if (!previous) return state;
  return {
    present: clone(previous),
    past: state.past.slice(0, -1),
    future: [clone(state.present), ...state.future].slice(0, 20),
  };
}
export function redoGeometry(state: GeometryState): GeometryState {
  const next = state.future[0];
  if (!next) return state;
  return {
    present: clone(next),
    past: [...state.past, clone(state.present)].slice(-20),
    future: state.future.slice(1),
  };
}
