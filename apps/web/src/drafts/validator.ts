import type { Lifecycle } from "@exhibitos/spec";
import { validateLifecycle } from "./exhibition-validation.mjs";
export type Draft = Extract<Lifecycle, { kind: "exhibition-draft" }>;
import { validateStudioMaterials } from "@exhibitos/studio-contract";
import type { ValidationResult } from "@exhibitos/spec";
export function validateDraft(document: unknown): ValidationResult {
  const result = validateLifecycle(document);
  if (!result.valid) return result;
  return validateStudioMaterials((document as Draft).candidate);
}
