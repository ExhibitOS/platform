// SPDX-License-Identifier: AGPL-3.0-or-later
import {ApiError} from './api-error.ts';
import {APPROVED_DEMO_DISPLAY_FILES} from './approved-demo-display-files.ts';
export interface ImageCoarseIntent {version:1;profile:'viewer-png-box-512-v1';approvalId:string;artworkRevision:number}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const IMAGE_COARSE_INTENT_SCHEMA={type:'object',additionalProperties:false,required:['version','profile','approvalId','artworkRevision'],properties:{version:{const:1},profile:{const:'viewer-png-box-512-v1'},approvalId:{type:'string',pattern:uuid.source},artworkRevision:{type:'integer',minimum:1,maximum:2147483647}}};
/** Intent only: callers cannot supply hashes, keys, asset IDs or a receipt. */
export function imageCoarseIntent(value:unknown):ImageCoarseIntent|undefined{
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'COARSE_INTENT_INVALID');
 const v=value as Record<string,unknown>,keys=['version','profile','approvalId','artworkRevision'];
 if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||v.version!==1||v.profile!=='viewer-png-box-512-v1'||typeof v.approvalId!=='string'||!uuid.test(v.approvalId)||!Number.isSafeInteger(v.artworkRevision)||Number(v.artworkRevision)<1||Number(v.artworkRevision)>2147483647)throw new ApiError(400,'COARSE_INTENT_INVALID');
 return {...value as ImageCoarseIntent,approvalId:v.approvalId.toLowerCase()};
}
/** A manifest approval binds server-observed original and full PNG bytes. */
export function imageCoarsePolicy(intent:ImageCoarseIntent,originalSha256:string,primarySha256:string,primaryBytes:number,recipe?:unknown){
 const policy=APPROVED_DEMO_DISPLAY_FILES.find(p=>p.approvalId.toLowerCase()===intent.approvalId.toLowerCase());
 if(!policy||!('coarse' in policy)||policy.rawSourceSha256!==originalSha256||policy.canonicalAssetSha256!==primarySha256||policy.canonicalBytes!==primaryBytes)throw new ApiError(422,'COARSE_POLICY_UNQUALIFIED');
 if(recipe!==undefined){const r=recipe as {recipeSha256?:unknown;settingsSha256?:unknown;sourcePixelsSha256?:unknown;outputPixelsSha256?:unknown;toolVersion?:unknown;colourConversion?:{algorithm?:unknown;sourceIccSha256?:unknown}};if(!r||r.recipeSha256!==policy.recipeSha256||r.settingsSha256!=='75e2dd0126e0aca3402cbaf0bc25f40f4cdd221167704b5280293941749ffd01'||r.sourcePixelsSha256!=='4fa6dc5b4449180ba079e33b27ad378a247a215f24463752463bf9e396e14d47'||r.outputPixelsSha256!=='c62b9a101bfe04652d52df6dcc9bed65f1235e280f531ed16bb5d935f62e842a'||r.toolVersion!=='ExhibitOSManager.ImageIO/2/macOS-27.2.0'||intent.approvalId!=='ce328328-97fa-56cf-8fc1-6bafd4573153'||r.colourConversion?.algorithm!=='icc-to-srgb-jpeg-rgb8-v1'||r.colourConversion.sourceIccSha256!=='f6bd2776ef85c5a0a9313989eb60f3db7996bc4af48453353f53840643d8e32b')throw new ApiError(422,'COARSE_POLICY_UNQUALIFIED');}
 return policy;
}

/** Persisted only by the server; a client never supplies this envelope. */
export type StoredImageCoarse={intent:ImageCoarseIntent;workspaceId:string;principalId:string;stageKey:string;sha256:string;bytes:number;assetId?:string};
export function storedImageCoarse(row:Record<string,unknown>):StoredImageCoarse|undefined{
 const derived=row.derived;if(!derived||typeof derived!=='object'||Array.isArray(derived)||!Object.hasOwn(derived,'viewerCoarse'))return undefined;
 const value=(derived as Record<string,unknown>).viewerCoarse;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(409,'COARSE_STATE_INVALID');
 const v=value as Record<string,unknown>,keys=['intent','workspaceId','principalId','stageKey','sha256','bytes',...(Object.hasOwn(v,'assetId')?['assetId']:[])];
 if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||typeof row.id!=='string'||typeof row.tenant_id!=='string'||typeof row.expected_hash!=='string')throw new ApiError(409,'COARSE_STATE_INVALID');
 const intent=imageCoarseIntent(v.intent);const full=(derived as Record<string,unknown>);
 if(!intent||typeof full.sha256!=='string'||typeof full.bytes!=='number'||!full.recipe||typeof full.recipe!=='object')throw new ApiError(409,'COARSE_STATE_INVALID');
 const policy=imageCoarsePolicy(intent,row.expected_hash,full.sha256,full.bytes,full.recipe),coarse=policy.coarse;
 if(typeof v.workspaceId!=='string'||!uuid.test(v.workspaceId)||v.principalId!==row.user_id||typeof v.principalId!=='string'||!uuid.test(v.principalId)||v.sha256!==coarse.sha256||v.bytes!==coarse.bytes||v.stageKey!==`${row.tenant_id}/quarantine/import-${row.id}/coarse-${coarse.sha256}`||(v.assetId!==undefined&&(typeof v.assetId!=='string'||!uuid.test(v.assetId))))throw new ApiError(409,'COARSE_STATE_INVALID');
 return value as StoredImageCoarse;
}
