import type { Lifecycle } from "@exhibitos/spec";
import { validateLifecycle } from "./exhibition-validation.mjs";
export type Draft = Extract<Lifecycle, { kind: "exhibition-draft" }>;
import { validateStudioMaterials, validateStudioPresentation } from "@exhibitos/studio-contract";
import type { ValidationResult } from "@exhibitos/spec";
export function validateDraft(document: unknown): ValidationResult {
  const result = validateLifecycle(document);
  if (!result.valid) return result;
  const materials = validateStudioMaterials((document as Draft).candidate);
  if (!materials.valid) return materials;
  return validateStudioPresentation((document as Draft).candidate);
}
