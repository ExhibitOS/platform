// SPDX-License-Identifier: AGPL-3.0-or-later
import {ApiError} from './api-error.ts';
import type {CompactModelReceipt} from './oam-original-preparation.ts';
export interface ProvisionalDisplayReference {
 version:1;status:'provisional-uncalibrated';assetSha256:string;
 rawBounds:{min:[number,number,number];max:[number,number,number]};
 referenceHeightMeters:number;
 pose:{position:[number,number,number];rotation:[number,number,number,number];scale:[number,number,number]};
}
const exact=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
/** The existing provisional reference is a display size, never a physical-unit claim. */
export function validDisplayReference(input:unknown):input is ProvisionalDisplayReference {
 if(!exact(input,['version','status','assetSha256','rawBounds','referenceHeightMeters','pose']))return false;
 const value=input as ProvisionalDisplayReference;
 if(value.version!==1||value.status!=='provisional-uncalibrated'||typeof value.assetSha256!=='string'||!/^([a-f0-9]{64})$/.test(value.assetSha256)||!exact(value.rawBounds,['min','max'])||!exact(value.pose,['position','rotation','scale']))return false;
 const {min,max}=value.rawBounds,{position,rotation,scale}=value.pose;
 if(![min,max,position,rotation,scale].every(Array.isArray)||min.length!==3||max.length!==3||position.length!==3||rotation.length!==4||scale.length!==3||![...min,...max,...position,...rotation,...scale,value.referenceHeightMeters].every(Number.isFinite)||min.some(v=>Math.abs(v)>1000000)||max.some(v=>Math.abs(v)>1000000)||value.referenceHeightMeters<=0||value.referenceHeightMeters>10000)return false;
 const extent=max.map((n,i)=>n-min[i]!);if(extent.some(n=>n<=0||n>10000))return false;
 const expected=value.referenceHeightMeters/extent[1]!,tolerance=Math.max(1e-12,Math.abs(expected)*1e-9);
 return position.every(v=>v===0)&&rotation.every((v,i)=>v===(i===3?1:0))&&scale.every(v=>v>=1e-6&&v<=100&&Math.abs(v-expected)<=tolerance);
}
/** Bind only an unchanged-coordinate product result to its actual display hash.
 * JSON accessor bounds may spell the same Float32 value differently. This
 * comparison never tolerates changed vertex coordinates or invents source units. */
export function preparedDisplayReference(source:ProvisionalDisplayReference,producer:CompactModelReceipt):ProvisionalDisplayReference {
 const fail=():never=>{throw new ApiError(409,'MODEL_PREPARATION_DISPLAY_REFERENCE_INVALID');};
 if(!validDisplayReference(source)||source.assetSha256!==producer.source.sha256)fail();
 for(const edge of ['min','max'] as const){
  if(producer.source.bounds[edge].length!==3||producer.output.bounds[edge].length!==3)fail();
  for(let i=0;i<3;i++)if(!Number.isFinite(producer.source.bounds[edge][i])||Math.fround(source.rawBounds[edge][i]!)!==producer.source.bounds[edge][i]||producer.source.bounds[edge][i]!==producer.output.bounds[edge][i])fail();
 }
 const result=structuredClone(source);result.assetSha256=producer.output.sha256;
 // Preserve the author-selected reference height/pose and original JSON bounds:
 // the product proves these represent the same unchanged Float32 coordinates.
 if(!validDisplayReference(result))fail();return result;
}
