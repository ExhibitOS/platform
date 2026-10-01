// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 ExhibitOS contributors
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "@exhibitos/spec/schemas/artwork.json" with { type: "json" };

export const ARTWORK_VERSION = "1.0.0-draft.1";
export const MAX_DOCUMENT_BYTES = 1048576;
export const MAX_ASSET_TOTAL_BYTES = 268435456;
const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  validateFormats: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
addFormats(ajv, ["uuid", "date-time"]);
const validate = ajv.compile(schema);
const validateUtc = ajv.compile({
  type: "string",
  format: "date-time",
  pattern: schema.properties.createdAt.pattern,
});
const rightsSchema = ajv.compile(schema.$defs.rights);
const issue = (code, path, message) => ({ code, path, message });

export function validateArtwork(document, { publicationTime } = {}) {
  if (document?.schemaVersion !== ARTWORK_VERSION)
    return {
      valid: false,
      errors: [
        issue(
          "UNSUPPORTED_VERSION",
          "/schemaVersion",
          "Expected " + ARTWORK_VERSION,
        ),
      ],
    };
  if (!validate(document))
    return {
      valid: false,
      errors: validate.errors
        .slice(0, 100)
        .map((error) =>
          issue("SCHEMA_INVALID", error.instancePath, error.keyword),
        ),
    };
  const errors = [];
  const add = (code, path, message) => {
    if (errors.length < 100) errors.push(issue(code, path, message));
  };
  const ids = new Set(),
    paths = new Set();
  for (const [i, asset] of document.assets.entries()) {
    if (ids.has(asset.id))
      add("DUPLICATE_ASSET_ID", `/assets/${i}/id`, "Asset IDs must be unique");
    ids.add(asset.id);
    if (paths.has(asset.path))
      add("DUPLICATE_ASSET_PATH", `/assets/${i}/path`, "Paths must be unique");
    paths.add(asset.path);
    if ((asset.role === "model") !== (asset.mime === "model/gltf-binary"))
      add(
        "ASSET_ROLE_MIME_MISMATCH",
        `/assets/${i}`,
        "Model role requires GLB; images require image MIME",
      );
    const suffix = {
      "model/gltf-binary": ".glb",
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/webp": ".webp",
    }[asset.mime];
    if (!asset.path.endsWith(suffix))
      add(
        "ASSET_EXTENSION_MISMATCH",
        `/assets/${i}/path`,
        "File suffix must match MIME",
      );
  }
  if (
    document.assets.reduce((sum, asset) => sum + asset.bytes, 0) >
    MAX_ASSET_TOTAL_BYTES
  )
    add("ASSET_TOTAL_LIMIT", "/assets", "Asset total exceeds 256MiB");
  const primary = document.assets.find(
    (asset) => asset.id === document.primaryAssetId,
  );
  if (!primary)
    add(
      "MISSING_PRIMARY_ASSET",
      "/primaryAssetId",
      "Primary asset must resolve",
    );
  else if (
    primary.role !== (document.artworkType === "sculpture" ? "model" : "image")
  )
    add(
      "PRIMARY_ASSET_ROLE",
      "/primaryAssetId",
      "Primary role must match artwork type",
    );
  if (
    document.artworkType === "sculpture" &&
    document.dimensions.depth === undefined
  )
    add(
      "MISSING_DEPTH",
      "/dimensions/depth",
      "Sculpture needs positive physical depth",
    );
  if (Math.abs(Math.hypot(...document.transform.rotation) - 1) > 1e-6)
    add(
      "QUATERNION_NOT_NORMALIZED",
      "/transform/rotation",
      "XYZW quaternion norm must be within 1e-6 of one",
    );
  const eventIds = new Set();
  document.provenance.events.forEach((event, i) => {
    if (eventIds.has(event.id))
      add(
        "DUPLICATE_PROVENANCE_ID",
        `/provenance/events/${i}/id`,
        "Event IDs must be unique",
      );
    eventIds.add(event.id);
    event.sourceAssetIds?.forEach((id) => {
      if (!ids.has(id))
        add(
          "MISSING_PROVENANCE_ASSET",
          `/provenance/events/${i}/sourceAssetIds`,
          "Source asset must resolve in this artifact",
        );
    });
  });
  const conversion = document.provenance.scaleConversion;
  if (conversion) {
    const multiplier = {
      meter: 1,
      centimeter: 0.01,
      millimeter: 0.001,
      inch: 0.0254,
      foot: 0.3048,
    }[conversion.sourceUnit];
    if (Math.abs(conversion.multiplierToMeters - multiplier) > 1e-12)
      add(
        "UNIT_CONVERSION_MISMATCH",
        "/provenance/scaleConversion/multiplierToMeters",
        "Multiplier must match declared source unit",
      );
    conversion.appliedToAssetIds.forEach((id) => {
      if (!ids.has(id))
        add(
          "MISSING_CONVERTED_ASSET",
          "/provenance/scaleConversion/appliedToAssetIds",
          "Converted asset must resolve",
        );
    });
  }
  const utcValues = [
    ["/createdAt", document.createdAt],
    ...document.provenance.events.map((event, i) => [
      `/provenance/events/${i}/at`,
      event.at,
    ]),
    ["/rights/validFrom", document.rights.validFrom],
    ["/rights/expiresAt", document.rights.expiresAt],
  ];
  for (const [path, value] of utcValues)
    if (value !== undefined && !Number.isFinite(Date.parse(value)))
      add("INVALID_UTC_TIME", path, "Timestamp must parse to a finite instant");
  errors.push(...validateRights(document.rights, { publicationTime }).errors);
  return { valid: errors.length === 0, errors: errors.slice(0, 100) };
}

export function validateRights(rights, { publicationTime } = {}) {
  if (!rightsSchema(rights))
    return {
      valid: false,
      errors: rightsSchema.errors
        .slice(0, 100)
        .map((error) =>
          issue(
            "SCHEMA_INVALID",
            "/rights" + error.instancePath,
            error.keyword,
          ),
        ),
    };
  const errors = [];
  const add = (code, path, message) => {
    if (errors.length < 100) errors.push(issue(code, path, message));
  };
  for (const property of ["validFrom", "expiresAt"])
    if (
      rights[property] !== undefined &&
      !Number.isFinite(Date.parse(rights[property]))
    )
      add(
        "INVALID_UTC_TIME",
        "/rights/" + property,
        "Timestamp must parse to a finite instant",
      );
  if (
    rights.validFrom &&
    rights.expiresAt &&
    Date.parse(rights.validFrom) >= Date.parse(rights.expiresAt)
  )
    add(
      "RIGHTS_TIME_RANGE",
      "/rights/expiresAt",
      "Expiry must follow validFrom",
    );
  if (publicationTime !== undefined) {
    const time =
      typeof publicationTime === "string" && validateUtc(publicationTime)
        ? Date.parse(publicationTime)
        : NaN;
    if (!validateUtc(publicationTime) || !Number.isFinite(time))
      add(
        "INVALID_PUBLICATION_TIME",
        "/rights",
        "Publication time must be a UTC timestamp",
      );
    else {
      if (!rights.permissions.display)
        add(
          "DISPLAY_PERMISSION_REQUIRED",
          "/rights/permissions/display",
          "Publication requires display permission",
        );
      if (rights.validFrom && time < Date.parse(rights.validFrom))
        add(
          "RIGHTS_NOT_YET_VALID",
          "/rights/validFrom",
          "Display grant has not begun",
        );
      if (rights.expiresAt && time >= Date.parse(rights.expiresAt))
        add("RIGHTS_EXPIRED", "/rights/expiresAt", "Display grant expired");
    }
  }
  return { valid: errors.length === 0, errors: errors.slice(0, 100) };
}
