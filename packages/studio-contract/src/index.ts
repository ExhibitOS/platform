// SPDX-License-Identifier: AGPL-3.0-or-later
/** Platform-owned optional OES extension; not a change to the public base OES schema. */
export const MATERIAL_NAMESPACE = "org.exhibitos.studio/materials";
export const MAX_MATERIALS = 64;
export interface PbrMaterial {
  color: string;
  roughness: number;
  metalness: number;
}
export interface StudioMaterials {
  version: 1;
  surfaces: Record<string, PbrMaterial>;
}
export interface MaterialIssue {
  code: string;
  path: string;
  message: string;
}
export interface MaterialValidation {
  valid: boolean;
  errors: MaterialIssue[];
}
export const DEFAULT_MATERIAL: Readonly<PbrMaterial> = Object.freeze({
  color: "#f4f1e8",
  roughness: 0.8,
  metalness: 0,
});
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const path = "/candidate/extensions/org.exhibitos.studio~1materials";
export function validateStudioMaterials(
  candidate: unknown,
): MaterialValidation {
  const errors: MaterialIssue[] = [];
  const add = (code: string, suffix: string, message: string) =>
    errors.push({ code, path: path + suffix, message });
  if (
    !object(candidate) ||
    !object(candidate.extensions) ||
    !Object.hasOwn(candidate.extensions, MATERIAL_NAMESPACE)
  )
    return { valid: true, errors };
  const value = candidate.extensions[MATERIAL_NAMESPACE];
  if (!object(value)) {
    add("STUDIO_MATERIAL_SCHEMA", "", "Material extension must be an object");
    return { valid: false, errors };
  }
  if (value.version !== 1) {
    add(
      "STUDIO_MATERIAL_VERSION",
      "/version",
      "Only material extension version1 is supported",
    );
    return { valid: false, errors };
  }
  if (!exact(value, ["version", "surfaces"]) || !object(value.surfaces)) {
    add(
      "STUDIO_MATERIAL_SCHEMA",
      "",
      "Expected version and surface-ID material map",
    );
    return { valid: false, errors };
  }
  const entries = Object.entries(value.surfaces);
  if (entries.length > MAX_MATERIALS)
    add(
      "STUDIO_MATERIAL_LIMIT",
      "/surfaces",
      "Maximum64 surface material assignments",
    );
  const known = new Set(
      Array.isArray(candidate.surfaces)
        ? candidate.surfaces
            .filter(object)
            .map((surface) =>
              typeof surface.id === "string" ? surface.id.toLowerCase() : "",
            )
        : [],
    ),
    seen = new Set<string>();
  for (const [id, material] of entries.slice(0, MAX_MATERIALS + 1)) {
    if (
      !uuid.test(id) ||
      !known.has(id.toLowerCase()) ||
      seen.has(id.toLowerCase())
    )
      add(
        "STUDIO_MATERIAL_REFERENCE",
        "/surfaces/" + id,
        "Each distinct material key must reference an existing surface UUID",
      );
    seen.add(id.toLowerCase());
    if (
      !object(material) ||
      !exact(material, ["color", "roughness", "metalness"]) ||
      typeof material.color !== "string" ||
      !/^#[0-9a-f]{6}$/.test(material.color) ||
      ![material.roughness, material.metalness].every(
        (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1,
      )
    )
      add(
        "STUDIO_MATERIAL_SCHEMA",
        "/surfaces/" + id,
        "Expected lowercase #rrggbb and finite roughness/metalness within0..1",
      );
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > 16384)
      add("STUDIO_MATERIAL_LIMIT", "", "Maximum16KiB material extension");
  } catch {
    add(
      "STUDIO_MATERIAL_SCHEMA",
      "",
      "Only JSON material metadata is accepted",
    );
  }
  return { valid: errors.length === 0, errors };
}
/** Caller validates complete draft before using this projection. Returns a fresh value. */
export function materialFor(
  candidate: { extensions?: unknown },
  surfaceId: string,
): PbrMaterial {
  const extensions = object(candidate.extensions)
    ? candidate.extensions
    : undefined;
  const value = extensions?.[MATERIAL_NAMESPACE] as StudioMaterials | undefined;
  const entry =
    value && object(value.surfaces)
      ? Object.entries(value.surfaces).find(
          ([id]) => id.toLowerCase() === surfaceId.toLowerCase(),
        )?.[1]
      : undefined;
  return { ...(entry ?? DEFAULT_MATERIAL) };
}

export const PRESENTATION_NAMESPACE = "org.exhibitos.studio/presentation";
export interface StudioCamera {
    roomId: string;
    position: [
        number,
        number,
        number
    ];
    target: [
        number,
        number,
        number
    ];
    fov: number;
}
export interface StudioPresentation {
    version: 1;
    startCamera?: StudioCamera;
    viewpoints: (StudioCamera & {
        id: string;
        name: string;
    })[];
    credits: string;
}
/** Bounded metadata only; routes remain optional public OES navigation. */
export function validateStudioPresentation(candidate: unknown): MaterialValidation {
    const errors: MaterialIssue[] = [];
    const add = (code: string, suffix: string, message: string) => errors.push({ code, path: "/candidate/extensions/org.exhibitos.studio~1presentation" + suffix, message });
    if (!object(candidate) || !object(candidate.extensions) || !Object.hasOwn(candidate.extensions, PRESENTATION_NAMESPACE))
        return { valid: true, errors };
    const value = candidate.extensions[PRESENTATION_NAMESPACE];
    if (!object(value) || value.version !== 1) {
        add("STUDIO_PRESENTATION_VERSION", "", "Only presentation version 1 is supported");
        return { valid: false, errors };
    }
    const keys = value.startCamera === undefined ? ["version", "viewpoints", "credits"] : ["version", "startCamera", "viewpoints", "credits"];
    if (!exact(value, keys) || !Array.isArray(value.viewpoints) || value.viewpoints.length > 64 || typeof value.credits !== "string" || value.credits.length > 4096) {
        add("STUDIO_PRESENTATION_SCHEMA", "", "Expected at most 64 viewpoints and bounded credits");
        return { valid: false, errors };
    }
    const rooms = Array.isArray(candidate.rooms) ? candidate.rooms.filter(object) : [];
    const seen = new Set<string>();
    const vector = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 10000);
    const camera = (c: unknown, suffix: string, view: boolean) => {
        if (!object(c) || !exact(c, view ? ["id", "name", "roomId", "position", "target", "fov"] : ["roomId", "position", "target", "fov"]) || typeof c.roomId !== "string" || !vector(c.position) || !vector(c.target) || typeof c.fov !== "number" || !Number.isFinite(c.fov) || c.fov < 10 || c.fov > 120) {
            add("STUDIO_CAMERA_INVALID", suffix, "Expected a finite room camera with FOV 10..120 degrees");
            return;
        }
        const room = rooms.find(r => typeof r.id === "string" && r.id.toLowerCase() === (c.roomId as string).toLowerCase());
        if (!room || !object(room.dimensions)) {
            add("STUDIO_CAMERA_REFERENCE", suffix, "Camera must reference an existing room");
            return;
        }
        const d = room.dimensions;
        if (c.position[0]! < -(d.width as number) / 2 || c.position[0]! > (d.width as number) / 2 || c.position[1]! < 0 || c.position[1]! > (d.height as number) || c.position[2]! < -(d.depth as number) / 2 || c.position[2]! > (d.depth as number) / 2 || c.position.every((n, i) => Math.abs(n - (c.target as number[])[i]!) < 1e-8))
            add("STUDIO_CAMERA_INVALID", suffix, "Camera position must be inside room and target must differ");
        if (view) {
            if (typeof c.id !== "string" || !uuid.test(c.id) || seen.has(c.id.toLowerCase()) || typeof c.name !== "string" || c.name.length < 1 || c.name.length > 512)
                add("STUDIO_VIEWPOINT_INVALID", suffix, "Expected a distinct UUID and nonempty bounded name");
            if (typeof c.id === "string")
                seen.add(c.id.toLowerCase());
        }
    };
    if (value.startCamera !== undefined)
        camera(value.startCamera, "/startCamera", false);
    value.viewpoints.forEach((v, i) => camera(v, "/viewpoints/" + i, true));
    if (new TextEncoder().encode(JSON.stringify(value)).length > 32768)
        add("STUDIO_PRESENTATION_LIMIT", "", "Maximum 32 KiB presentation extension");
    return { valid: errors.length === 0, errors };
}
export function presentationFor(candidate: {
    extensions?: unknown;
}): StudioPresentation {
    const value = object(candidate.extensions) ? candidate.extensions[PRESENTATION_NAMESPACE] : undefined;
    return structuredClone((value as unknown as StudioPresentation | undefined) ?? { version: 1, viewpoints: [], credits: "" });
}

export * from "./viewer.js";

export * from "./experience.js";

export * from "./artwork-details.js";

export * from "./freeze.js";
export * from "./freeze-bundle.js";
export * from './architecture.js';

export * from './curation.js';

export * from "./scripting.js";
export * from "./scripting-runtime.js";

export * from "./scripting-profile.js";

export * from "./realtime.js";

export * from "./opening.js";

export * from "./artifact-affine.js";
