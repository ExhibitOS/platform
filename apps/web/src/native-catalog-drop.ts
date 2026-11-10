// SPDX-License-Identifier: AGPL-3.0-or-later
import type {CatalogBinding} from './native-catalog-protocol';
import type {NativeViewportFrame} from './native-viewport-protocol';

export const NATIVE_CATALOG_DROP_CAPABILITY='catalog-drop-target-v1';
type Point={x:number;y:number};
type FurnishingTarget='floor'|'frame'|'light';
export type CatalogDropRequest=CatalogBinding&(
 {targetKind:'artwork';phase:'drop';point:Point;placementRequestId:string}|
 {targetKind:FurnishingTarget;phase:'hover'|'drop';point:Point}|
 {targetKind:FurnishingTarget;phase:'clear'}
);
export type CatalogDropHit={kind:'artwork'}|{kind:'floor';roomId:string;position:[number,number,number]}|
 {kind:'frame';placementId:string}|{kind:'light';lightId:string};
export type CatalogDropReply=Pick<CatalogBinding,'version'|'requestId'|'epoch'|'sequence'>&{hit:CatalogDropHit|null};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const unit=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;
const exact=(value:Record<string,unknown>,fields:string[])=>Object.keys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key));

export function checkedCatalogDropRequest(value:unknown,frame:NativeViewportFrame|undefined):CatalogDropRequest {
 if(!frame||frame.disabled||frame.presentation==='plan'||!record(value))throw Error('CATALOG_DROP_UNAVAILABLE');
 const {targetKind,phase,point}=value;
 const artwork=targetKind==='artwork';
 const fields=['version','requestId','epoch','sequence','tenantId','principalId','targetKind','phase'];
 if(artwork)fields.push('placementRequestId');
 if(phase!=='clear')fields.push('point');
 if(!exact(value,fields)||value.version!==1||typeof value.requestId!=='string'||!uuid.test(value.requestId)||
    value.epoch!==frame.epoch||value.sequence!==frame.sequence||value.tenantId!==frame.tenantId||value.principalId!==frame.principalId)
  throw Error('CATALOG_DROP_STALE');
 if(artwork?(phase!=='drop'||typeof value.placementRequestId!=='string'||!uuid.test(value.placementRequestId)):
    (targetKind!=='floor'&&targetKind!=='frame'&&targetKind!=='light')||(phase!=='hover'&&phase!=='drop'&&phase!=='clear'))
  throw Error('CATALOG_DROP_INVALID');
 if(phase!=='clear'&&(!record(point)||!exact(point,['x','y'])||!unit(point.x)||!unit(point.y)))throw Error('CATALOG_DROP_INVALID');
 return value as unknown as CatalogDropRequest;
}
