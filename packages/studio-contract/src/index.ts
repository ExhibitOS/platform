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
