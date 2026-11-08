// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import type {DiagnosticAssetStage,DiagnosticEvent} from './diagnostic-source';

type Artwork=Pick<Exhibition['artworks'][number],'revisionId'|'assets'>;
interface Stage {stage:string;at:number;durationsMs:Record<string,number>;artworkRevisionId:string|null;errorCode:string|null}
/** Existing local loader readout, bounded to its latest 32 assets. Request keys
 * fence asynchronous diagnostics only; they never enter the display contract. */
export function createPreparationStages(artworks:readonly Artwork[],now=()=>performance.now(),pending:(key:string)=>boolean=()=>false,onRecord?:(event:DiagnosticAssetStage)=>void){
 const owners=new Map<string,Set<string>>();
 for(const art of artworks)for(const asset of art.assets){const id=asset.id.toLowerCase(),set=owners.get(id)??new Set<string>();set.add(art.revisionId.toLowerCase());owners.set(id,set);}
 const rows=new Map<string,Stage>(),latest=new Map<string,string>();
 const record=(assetId:string,stage:string,error?:unknown,key?:string,diagnostics?:Omit<DiagnosticAssetStage,keyof DiagnosticEvent>)=>{
  const id=assetId.toLowerCase(),revisions=owners.get(id),request=latest.get(id);
  if(!revisions||!/^[a-z][a-z0-9-]{0,63}$/.test(stage))return;
  if(key!==undefined?request!==key:request!==undefined&&pending(request))return;
  const at=now(),previous=rows.get(id),durationsMs={...previous?.durationsMs};
  if(previous)durationsMs[previous.stage]=(durationsMs[previous.stage]??0)+at-previous.at;
  // Filter to a canonical token, never publish a raw exception message/URL/stack.
  const errorCode=stage!=='cancelled-settled'&&error instanceof Error&&error.name!=='AbortError'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)?error.message:null;
  rows.delete(id);rows.set(id,{stage,at,durationsMs,artworkRevisionId:revisions.size===1?[...revisions][0]!:null,errorCode});
  onRecord?.({assetId:id,artworkRevisionId:revisions.size===1?[...revisions][0]!:null,stage,atMs:at,errorCode,...diagnostics});
  while(rows.size>32){const oldest=rows.keys().next().value!;rows.delete(oldest);const request=latest.get(oldest);if(request===undefined||!pending(request))latest.delete(oldest);}
  return true;
 };
 return {
  begin(assetId:string,key:string){const id=assetId.toLowerCase();if(!owners.has(id))return;latest.set(id,key);record(id,'queued',undefined,key);},
  record,
  settled(assetId:string,key:string){const id=assetId.toLowerCase();if(latest.get(id)===key&&!rows.has(id))latest.delete(id);},
  snapshot:()=>[...rows].map(([assetId,row])=>({assetId,...row,durationsMs:{...row.durationsMs}})),
 };
}
