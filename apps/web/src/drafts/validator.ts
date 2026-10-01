import type { Lifecycle } from "@exhibitos/spec";
import { validateLifecycle } from "./exhibition-validation.mjs";
export type Draft = Extract<Lifecycle, { kind: "exhibition-draft" }>;
export { validateLifecycle as validateDraft };
