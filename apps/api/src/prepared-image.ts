// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {ApiError} from './auth.ts';

export const MAX_PREPARED_IMAGE_BYTES=8388608;
export interface PreparedImage {
 mime:'image/png';bytes:number;sha256:string;
 recipe:{version:1;role:'baseColor';sampling:'nearest-centre';colourMeaning:'srgb'|'srgb-assumed';recipeSha256:string;settingsSha256:string;sourcePixelsSha256:string;outputPixelsSha256:string;toolVersion:string};
}
const digest={type:'string',pattern:'^[0-9a-f]{64}$'};
export const PREPARED_IMAGE_SCHEMA={type:'object',additionalProperties:false,required:['mime','bytes','sha256','recipe'],properties:{
 mime:{const:'image/png'},bytes:{type:'integer',minimum:1,maximum:MAX_PREPARED_IMAGE_BYTES},sha256:digest,
 recipe:{type:'object',additionalProperties:false,required:['version','role','sampling','colourMeaning','recipeSha256','settingsSha256','sourcePixelsSha256','outputPixelsSha256','toolVersion'],properties:{version:{const:1},role:{const:'baseColor'},sampling:{const:'nearest-centre'},colourMeaning:{enum:['srgb','srgb-assumed']},recipeSha256:digest,settingsSha256:digest,sourcePixelsSha256:digest,outputPixelsSha256:digest,toolVersion:{type:'string',minLength:1,maxLength:128,pattern:'^[ -~]+$'}}}
}};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:unknown,keys:string[])=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hex=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
/** Client-declared preparation provenance, never server-certified pixel equivalence. */
export function preparedImageInput(value:unknown):PreparedImage|undefined {
 if(value===undefined)return undefined;
 const fail=():never=>{throw new ApiError(400,'INVALID_DERIVED_INPUT');};
 if(!closed(value,['mime','bytes','sha256','recipe']))fail();
 const v=value as Record<string,unknown>;
 if(v.mime!=='image/png'||!Number.isSafeInteger(v.bytes)||Number(v.bytes)<1||Number(v.bytes)>MAX_PREPARED_IMAGE_BYTES||!hex(v.sha256)||!closed(v.recipe,['version','role','sampling','colourMeaning','recipeSha256','settingsSha256','sourcePixelsSha256','outputPixelsSha256','toolVersion']))fail();
 const r=v.recipe as Record<string,unknown>;
 if(r.version!==1||r.role!=='baseColor'||r.sampling!=='nearest-centre'||(r.colourMeaning!=='srgb'&&r.colourMeaning!=='srgb-assumed')||!['recipeSha256','settingsSha256','sourcePixelsSha256','outputPixelsSha256'].every(k=>hex(r[k]))||typeof r.toolVersion!=='string'||!r.toolVersion.trim()||!/^[ -~]{1,128}$/.test(r.toolVersion))fail();
 const canonical=JSON.stringify({colourMeaning:r.colourMeaning,role:r.role,sampling:r.sampling,version:r.version});
 if(createHash('sha256').update(canonical).digest('hex')!==r.recipeSha256)fail();
 return value as PreparedImage;
}
/** Supplement the existing strict PNG decoder with the agreed RGB8 preparation bounds. */
export function preparedImageHeader(bytes:Buffer){
 if(bytes.length<33||bytes.length>MAX_PREPARED_IMAGE_BYTES||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR'||bytes[24]!==8||bytes[25]!==2)throw new ApiError(422,'FORMAT_REJECTED');
 const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);if(!w||!h||w>2048||h>2048||w*h>4194304)throw new ApiError(422,'FORMAT_REJECTED');
}
