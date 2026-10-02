import type { Lifecycle } from "@exhibitos/spec";
import { validateLifecycle } from "./exhibition-validation.mjs";
export type Draft = Extract<Lifecycle, { kind: "exhibition-draft" }>;
import { validateViewerCuration, validateViewerExperience, validateArchitecture, validateStudioMaterials, validateStudioPresentation, validateViewerLod } from "@exhibitos/studio-contract";
import type { ValidationResult } from "@exhibitos/spec";
export function validateDraft(document: unknown): ValidationResult {
  const result = validateLifecycle(document);
  if (!result.valid) return result;
  const curation=validateViewerCuration((document as Draft).candidate);
  if(!curation.valid)return curation;
  const experience=validateViewerExperience((document as Draft).candidate);
  if(!experience.valid)return experience;
  const architecture=validateArchitecture((document as Draft).candidate);
  if(!architecture.valid)return architecture;
  const materials = validateStudioMaterials((document as Draft).candidate);
  if (!materials.valid) return materials;
  const presentation=validateStudioPresentation((document as Draft).candidate);
  if(!presentation.valid)return presentation;
  const errors=(document as Draft).candidate.artworks.flatMap((a,i)=>validateViewerLod(a).errors.map(e=>({...e,path:`/candidate/artworks/${i}${e.path}`})));
  return {valid:errors.length===0,errors};
}
