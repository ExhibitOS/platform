// SPDX-License-Identifier: AGPL-3.0-or-later
import {freezeCanonical} from './freeze.js';
import {WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from './workspace-furnishing.js';

export const WHEAT_SELECTED_SCOPE = 'installed-wheat-frame-v1';
export const WHEAT_IMAGE_FIT_SELECTED_SCOPE = 'installed-wheat-image-fit-v1';
export const PAINTING_BENCH_SELECTED_SCOPE = 'painting-bench-after-wheat-v1';
export const CLOSING_LIGHTS_SELECTED_SCOPE = 'closing-lights-after-wheat-fit-v1';
export const RETAINED_SPOTS_SELECTED_SCOPE = 'painting-eight-old-arrow-after-closing-v1';

export function selectedScopeRequiresWheatNotice(scope:unknown):scope is typeof WHEAT_SELECTED_SCOPE | typeof PAINTING_BENCH_SELECTED_SCOPE |
 typeof WHEAT_IMAGE_FIT_SELECTED_SCOPE | typeof CLOSING_LIGHTS_SELECTED_SCOPE | typeof RETAINED_SPOTS_SELECTED_SCOPE {
 return scope===WHEAT_SELECTED_SCOPE||scope===PAINTING_BENCH_SELECTED_SCOPE||scope===WHEAT_IMAGE_FIT_SELECTED_SCOPE||
  scope===CLOSING_LIGHTS_SELECTED_SCOPE||scope===RETAINED_SPOTS_SELECTED_SCOPE;
}
export const WHEAT_FRAME_ID = '4ddff48b-c2b2-5166-9e35-cd1c7aabb5b3';
export const WHEAT_FRAME_MODEL_SHA256 = 'a96b4942c2cd10b25fe1b33001443e1824fc125bc258f28a68547d38d8c54362';
export const WHEAT_FRAME_MODEL_BYTES = 3380;
export const WHEAT_STOCK_NOTICE = Object.freeze({
 bytes:580,sha256:'c9d8e0a394a5922f018b4d376fe575c499462d18216740b31bab1642617d077c',
 mime:'text/plain; charset=utf-8',path:'resources/workspace-furnishing/wheat-matte-oak-frame/LICENSE-NOTICE.txt',
 artifactPath:'workspace-furnishing/wheat-matte-oak-frame/LICENSE-NOTICE.txt',
} as const);

/** Public IDs are reminted. Only the exact installed Wheat asset and one
 * v11 attachment can carry this stock notice. Server custody is checked separately. */
export function installedWheatNoticeFor(scene:{extensions?:unknown}){
 const workspace=(scene.extensions as Record<string,unknown>|undefined)?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings|undefined;
 if(workspace?.version!==11||!Array.isArray(workspace.furnishings)||!Array.isArray(workspace.frameAttachments))return;
 const rights=freezeCanonical({holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',
  permissions:{display:true,download:true,export:true,commercial:true}});
 const frames=workspace.furnishings.filter(row=>row?.kind==='artwork-frame'&&row.version===1&&
  row.model?.sha256===WHEAT_FRAME_MODEL_SHA256&&row.model.mime==='model/gltf-binary'&&row.model.bytes===WHEAT_FRAME_MODEL_BYTES&&
  row.rights&&typeof row.rights==='object'&&freezeCanonical(row.rights)===rights&&
  row.provenance==='ExhibitOS default furnishings, wheat-matte-oak-frame v1. Original fixed-fit frame for Wheat Field with Cypresses.');
 if(frames.length!==1)return;
 const {id}=frames[0]!;
 const attachments=workspace.frameAttachments!.filter(row=>row?.furnishingId===id);
 if(attachments.length!==1||attachments[0]?.furnishingVersion!==1||attachments[0]?.modelSha256!==WHEAT_FRAME_MODEL_SHA256)return;
 return {...WHEAT_STOCK_NOTICE,assetId:id};
}

/** Older snapshots could carry the model without a notice. Preserve that
 * format unless the closed native scope requires the notice or it is declared. */
export function selectedWheatNotice(scene:{extensions?:unknown},declared:readonly {assetId?:string}[]|undefined,required=false){
 const known=installedWheatNoticeFor(scene);
 if(required&&!known)throw Error('WHEAT_STOCK_NOTICE_UNAVAILABLE');
 return known&&(required||Array.isArray(declared)&&declared.some(row=>row?.assetId===known.assetId))?known:undefined;
}
