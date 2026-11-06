import type {WorkspaceMaterial,WorkspaceMaterialBinding} from '@exhibitos/spec/workspace-material';
export const WORKSPACE_MATERIAL_NAMESPACE:'org.exhibitos.studio/workspace-materials';
export function workspaceFloorMaterials(document:unknown):Array<{binding:WorkspaceMaterialBinding;material:WorkspaceMaterial}>;
