// SPDX-License-Identifier: AGPL-3.0-or-later
import {validateExhibition,type Exhibition} from '@exhibitos/spec';
import {SPACE_STILL_NAMESPACE} from '@exhibitos/spec/space-still';
import {FOOTSTEP_RESOURCE_NAMESPACE} from '@exhibitos/spec/footstep-resources';
import {workspaceMaterialOutputInventory} from './workspace-material-output.ts';
import {WORKSPACE_MATERIAL_NAMESPACE} from '@exhibitos/spec/workspace-material';
import {WORKSPACE_FURNISHING_NAMESPACE} from '@exhibitos/spec/workspace-furnishing';
import {WORKSPACE_FURNISHING_NAMESPACE as STUDIO_WORKSPACE_FURNISHING_NAMESPACE,validateWorkspaceFurnishings,type WorkspaceFurnishings,FURNISHING_NAMESPACE,validateFurnishings,VIEWING_PLAN_NAMESPACE,validateViewingPlan,ARTWORK_THUMBNAIL_NAMESPACE,validateArtworkThumbnail,FLOOR_NAMESPACE,validateStudioFloors,ARCHITECTURAL_FINISH_NAMESPACE,validateArchitecturalFinishes,PLAQUE_NAMESPACE,validateStudioPlaques,SPACE_LIGHTING_NAMESPACE,validateStudioLightDetails,LIGHT_DETAILS_NAMESPACE,validateLightAttachments,LIGHT_ATTACHMENT_NAMESPACE,validateStudioBenches,BENCH_NAMESPACE,DISPLAY_POLICY_NAMESPACE,validateArtworkDisplayPolicy,INSTALLATION_NAMESPACE,validateStudioInstallation,ENTRANCE_NAMESPACE,validateViewerEntrance,SPATIAL_NAMESPACE,validateSpatialProfile,DAYLIGHT_NAMESPACE,TEMPLATE_NAMESPACE,validateViewerCuration,CURATION_NAMESPACE,validateArchitecture,MATERIAL_NAMESPACE,PRESENTATION_NAMESPACE,EXPERIENCE_NAMESPACE,LOD_NAMESPACE,ARTWORK_DETAILS_NAMESPACE,validateStudioMaterials,validateStudioPresentation,validateViewerExperience,validateViewerLod,validateArtworkDetails} from '@exhibitos/studio-contract';
import {ApiError} from './api-error.ts';
import {validRights} from './rights.ts';
import {qualifyDemoDisplay} from './demo-display-policy.ts';
import {MAX_UPLOAD} from './upload-limits.ts';
const CMS='org.exhibitos.studio/cms';
const LEGAL_NOTICES={'org.exhibitos/apache-license':'Apache-2.0','org.exhibitos/cc0-license':'CC0-1.0'} as const;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Public projections never opt into private CMS or workspace bindings. */
export function checkPublicOexProfile(e:Exhibition,workspaceFurnishingOutput=false,workspaceMaterialOutput=false){if(workspaceFurnishingOutput&&(!validateWorkspaceFurnishings(e).valid||((e.extensions?.[STUDIO_WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined)?.furnishings??[]).some(item=>!validRights(item.rights))))throw new ApiError(422,'OEX_PROFILE_INVALID');if(workspaceMaterialOutput)workspaceMaterialOutputInventory(e);return checkPortableOexProfile(e,false,undefined,workspaceMaterialOutput,workspaceFurnishingOutput);}
/** Known platform namespaces are validated, never executable. Unknown nested namespaces fail closed. */
export function checkPortableOexProfile(e:Exhibition,privateBindings=false,archiveProfile?:'bounded-file-v1',workspaceOutput=false,workspaceFurnishingOutput=false){
 for(const[namespace,licenseId]of Object.entries(LEGAL_NOTICES))if(e.extensions&&Object.hasOwn(e.extensions,namespace)){
  const notice=e.extensions[namespace];
  if(!object(notice)||Object.keys(notice).length!==3||!['scope','licenseId','text'].every(k=>Object.hasOwn(notice,k))||notice.licenseId!==licenseId||typeof notice.scope!=='string'||notice.scope.length<1||notice.scope.length>512||!notice.scope.trim()||typeof notice.text!=='string'||notice.text.length<1||notice.text.length>32768||!notice.text.trim())throw new ApiError(422,'OEX_LEGAL_NOTICE_INVALID');
 }


 if(!validateFurnishings(e).valid||e.artworks.length>64||e.mediaAssets.length>32||!validateExhibition(e,{archiveProfile}).valid||!validateArchitecture(e,true).valid||!validateStudioMaterials(e).valid||!validateStudioPresentation(e).valid||!validateStudioLightDetails(e).valid||!validateLightAttachments(e).valid||!validateArchitecturalFinishes(e).valid || !validateStudioPlaques(e).valid || !validateStudioBenches(e).valid||!validateStudioInstallation(e).valid||!validateStudioFloors(e).valid||!validateViewerEntrance(e).valid||!validateSpatialProfile(e).valid||!validateViewerCuration(e).valid||!validateViewingPlan(e).valid||!validateViewerExperience(e).valid||e.artworks.some(a=>!validateViewerLod(a).valid||!validateArtworkDetails(a).valid||!validateArtworkDisplayPolicy(a).valid||!validateArtworkThumbnail(a).valid))throw new ApiError(422,'OEX_PROFILE_INVALID');
 const scan=(v:unknown,scope:'exhibition'|'artwork'|'nested')=>{
  if(Array.isArray(v)){for(const x of v)scan(x,'nested');return;}
  if(!object(v))return;
  if(Object.hasOwn(v,'extensions')){
   if(!object(v.extensions))throw new ApiError(422,'OEX_EXTENSION_UNSUPPORTED');
   const allowed=scope==='exhibition'?[FURNISHING_NAMESPACE,DAYLIGHT_NAMESPACE,TEMPLATE_NAMESPACE,MATERIAL_NAMESPACE,PRESENTATION_NAMESPACE,INSTALLATION_NAMESPACE,FLOOR_NAMESPACE,BENCH_NAMESPACE,ARCHITECTURAL_FINISH_NAMESPACE,PLAQUE_NAMESPACE,LIGHT_DETAILS_NAMESPACE,LIGHT_ATTACHMENT_NAMESPACE,SPACE_LIGHTING_NAMESPACE,ENTRANCE_NAMESPACE,SPACE_STILL_NAMESPACE,EXPERIENCE_NAMESPACE,CURATION_NAMESPACE,VIEWING_PLAN_NAMESPACE,SPATIAL_NAMESPACE,FOOTSTEP_RESOURCE_NAMESPACE,...(workspaceOutput?[WORKSPACE_MATERIAL_NAMESPACE]:[]),...(workspaceFurnishingOutput?[WORKSPACE_FURNISHING_NAMESPACE]:[]),...Object.keys(LEGAL_NOTICES)]:scope==='artwork'?[LOD_NAMESPACE,ARTWORK_DETAILS_NAMESPACE,DISPLAY_POLICY_NAMESPACE,ARTWORK_THUMBNAIL_NAMESPACE,...(v.schemaVersion==='1.0.0-draft.2'?['org.exhibitos.studio/display-reference']:[]),...(privateBindings?[CMS]:[])]:[];
   if(Object.keys(v.extensions).some(k=>!allowed.includes(k)))throw new ApiError(422,'OEX_EXTENSION_UNSUPPORTED');
  }
  for(const [k,x]of Object.entries(v)){if(k==='extensions')continue;if(k==='artworks'&&scope==='exhibition'){for(const a of x as unknown[])scan(a,'artwork');}else scan(x,'nested');}
 };
 scan(e,'exhibition');
 for(const a of e.artworks){qualifyDemoDisplay(a);if(!validRights(a.rights)||a.assets.length>8||a.assets.some(x=>!['image/png','model/gltf-binary'].includes(x.mime)||x.bytes>MAX_UPLOAD))throw new ApiError(422,'OEX_PROFILE_INVALID');}
 for(const m of e.mediaAssets)if(m.mime!=='audio/wav'||!validRights(m.rights))throw new ApiError(422,'OEX_PROFILE_INVALID');
}
