// SPDX-License-Identifier: AGPL-3.0-or-later

import {passiveCeilingRailGeometry} from '@exhibitos/spec/ceiling-rail';
import {modularPortalParts,type WorkspaceFitGeometry,type WorkspaceFitProfile} from '@exhibitos/spec/workspace-fit-models';
export type {WorkspaceFitGeometry,WorkspaceFitProfile} from '@exhibitos/spec/workspace-fit-models';
export type WorkspaceFitReceipt = {version:1;sourceSha256:string;sourceBytes:number;geometry:WorkspaceFitGeometry};

const finite=(n:unknown,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

export function isWorkspaceFitGeometry(value:unknown,profile:WorkspaceFitProfile):value is WorkspaceFitGeometry{
 if(!record(value)||value.profile!==profile)return false;
 if(profile==='passive-ceiling-rail-v1')return passiveCeilingRailGeometry(value);
 const keys=Object.keys(value).sort().join(',');
 if(profile==='modular-portal-v1')return modularPortalParts(value);
 if(profile==='straight-ring-v1'||profile==='straight-miter-ring-v1')return keys==='imagePlaneZ,openingHeight,openingWidth,profile'&&finite(value.openingWidth,.4,2)&&finite(value.openingHeight,.4,2)&&value.imagePlaneZ===-.012;
 return keys==='maxZ,minZ,openingHeight,openingWidth,profile'&&finite(value.openingWidth,.9,3)&&finite(value.openingHeight,2,3.2)&&finite(value.minZ,-.15,-.015)&&finite(value.maxZ,.015,.15);
}

export function isWorkspaceFitReceipt(value:unknown,model:{sha256:string;bytes:number},profile:WorkspaceFitProfile):value is WorkspaceFitReceipt{
 return record(value)&&Object.keys(value).sort().join(',')==='geometry,sourceBytes,sourceSha256,version'&&value.version===1&&value.sourceSha256===model.sha256&&value.sourceBytes===model.bytes&&isWorkspaceFitGeometry(value.geometry,profile);
}
