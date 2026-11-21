// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {validateArchitecturalFinishes} from './architectural-finishes.js';
import {assertReciprocalDoorApertures,DoorPairEditError,reciprocalDoorPair} from './door-connection.js';
import {furnishingsFor} from './furnishings.js';
import {PAIRED_WALL_STRUCTURE_NAMESPACE,type PairedWallStructure} from './paired-wall-structure.js';
import {assertOpeningsClearOfWallArtwork} from './room-envelope.js';
import {freezeCanonical} from './freeze.js';
import {validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishingDescriptor,
 type WorkspaceFurnishings,type WorkspaceOpeningAttachment} from './workspace-furnishing.js';

type Opening = Exhibition['openings'][number];
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const workspaceFor=(scene:Exhibition)=>scene.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
const roomFor=(scene:Exhibition,opening:Opening)=>scene.surfaces.find(wall=>same(wall.id,opening.surfaceId))?.roomId;
const pairLocation=(scene:Exhibition,opening:Opening)=>[opening.id,roomFor(scene,opening)] as const;
const byPair=(pair:[Opening,Opening],id:string)=>pair.some(opening=>same(opening.id,id));

function pairAttachments(scene:Exhibition,pair:[Opening,Opening]) {
 return workspaceFor(scene)?.openingAttachments?.filter(row=>byPair(pair,row.openingId))??[];
}

function replacePortal(scene:Exhibition,previous:WorkspaceOpeningAttachment|undefined,
 replacement?:{opening:Opening;source:WorkspaceFurnishingDescriptor}):Exhibition{
 const current=workspaceFor(scene);
 if(!previous&&!replacement)return scene;
 const data:WorkspaceFurnishings=current?structuredClone(current):{version:6,furnishings:[],placements:[],frameAttachments:[],openingAttachments:[]};
 data.openingAttachments=(data.openingAttachments??[]).filter(row=>!previous||!same(row.openingId,previous.openingId));
 if(previous&&!data.openingAttachments.some(row=>same(row.furnishingId,previous.furnishingId))&&
    !data.placements.some(row=>same(row.furnishingId,previous.furnishingId))&&
    !data.frameAttachments?.some(row=>same(row.furnishingId,previous.furnishingId))){
  data.furnishings=data.furnishings.filter(row=>!same(row.id,previous.furnishingId));
 }
 if(replacement){
  const {opening,source}=replacement;
  const known=data.furnishings.find(row=>same(row.id,source.id));
  if(known&&freezeCanonical(known)!==freezeCanonical(source))throw new DoorPairEditError('frame-fit',...pairLocation(scene,opening));
  if(!known)data.furnishings.push(structuredClone(source));
  data.openingAttachments.push({openingId:opening.id,furnishingId:source.id,furnishingVersion:source.version,modelSha256:source.model.sha256});
  data.frameAttachments??=[];
  if(data.version<6)data.version=6;
  if(source.fit&&data.version<7)data.version=7;
 }
 const extensions:NonNullable<Exhibition["extensions"]>={...scene.extensions};
 if(!data.furnishings.length)delete extensions[WORKSPACE_FURNISHING_NAMESPACE];
 else{
  if(data.version===6&&!data.openingAttachments.length){
   data.version=5;
   delete data.openingAttachments;
  }
  extensions[WORKSPACE_FURNISHING_NAMESPACE]=data as unknown as NonNullable<Exhibition['extensions']>[string];
 }
 return {...scene,extensions};
}

function assertDoorContents(scene:Exhibition,pair:[Opening,Opening]){
 assertReciprocalDoorApertures(scene,pair);
 for(const opening of pair){
  const roomId=roomFor(scene,opening)!;
  try{assertOpeningsClearOfWallArtwork(scene,roomId,[opening]);}
  catch{throw new DoorPairEditError('artwork-overlap',opening.id,roomId);}
 }
 const [location]=pair;
 if(!validateWorkspaceFurnishings(scene).valid){
  const attachment=pairAttachments(scene,pair)[0];
  const host=pair.find(opening=>attachment&&same(opening.id,attachment.openingId))??location;
  throw new DoorPairEditError('frame-fit',...pairLocation(scene,host));
 }
 if(!validateArchitecturalFinishes(scene).valid)throw new DoorPairEditError('structure-clearance',...pairLocation(scene,location));
}

/** This function accepts a server-verified descriptor, never an untrusted catalogue snapshot. */
export function editReciprocalDoorPair(base:Exhibition,openingId:string,dimensions?:Opening['dimensions'],
 frame?:WorkspaceFurnishingDescriptor|null):{candidate:Exhibition;openingIds:[string,string]}{
 const pair=reciprocalDoorPair(base,openingId),[first,second]=pair;
 const openingIds:[string,string]=[first.id,second.id];
 const locations=pairAttachments(base,pair);
 const olderBinding=furnishingsFor(base)?.bindings.some(row=>row.hostKind==='opening'&&byPair(pair,row.hostId));
 if(locations.length>1||olderBinding)throw new DoorPairEditError('frame-conflict',...pairLocation(base,first));
 const ext=base.extensions?.[PAIRED_WALL_STRUCTURE_NAMESPACE] as unknown as PairedWallStructure|undefined;
 if(frame&&(frame.kind!=='portal-finish'||ext?.pairs.some(row=>byPair(pair,row.openingId)||byPair(pair,row.peerOpeningId))))
  throw new DoorPairEditError('frame-conflict',...pairLocation(base,first));
 let candidate=base;
 if(dimensions){
  if(!Number.isFinite(dimensions.width)||!Number.isFinite(dimensions.height)||dimensions.width<=0||dimensions.height<=0)
   throw new DoorPairEditError('wall-bounds',...pairLocation(base,first));
  const openings=base.openings.map(opening=>byPair(pair,opening.id)?{...opening,dimensions:{...dimensions},
   offset:[opening.offset[0],opening.offset[1]-opening.dimensions.height/2+dimensions.height/2] as [number,number]}:opening);
  candidate={...base,openings};
 }
 const current=reciprocalDoorPair(candidate,openingId);
 if(frame===null)candidate=replacePortal(candidate,locations[0]);
 else if(frame){
  const oldHost=current.find(opening=>locations[0]&&same(opening.id,locations[0].openingId));
  const possible=oldHost?[oldHost,...current.filter(opening=>opening!==oldHost)]:current;
  let accepted:Exhibition|undefined;
  for(const opening of possible){
   const proposed=replacePortal(candidate,locations[0],{opening,source:frame});
   if(validateWorkspaceFurnishings(proposed).valid){accepted=proposed;break;}
  }
  if(!accepted)throw new DoorPairEditError('frame-fit',...pairLocation(candidate,possible[0]!));
  candidate=accepted;
 }
 assertDoorContents(candidate,current);
 return {candidate,openingIds};
}

/** The Save path enforces paired geometry even for callers that bypass the proposal route. */
export function assertReciprocalDoorEdits(before:Exhibition,after:Exhibition) {
 const seen=new Set<string>();
 for(const old of before.openings){
  if(old.type!=='door'||old.exterior||!old.connectsToOpeningId||seen.has(old.id.toLowerCase()))continue;
  const previousPeer=before.openings.find(row=>same(row.id,old.connectsToOpeningId!));
  if(previousPeer?.type!=='door'||previousPeer.exterior||!previousPeer.connectsToOpeningId||
     !same(previousPeer.connectsToOpeningId,old.id))continue;
  const next=after.openings.find(row=>same(row.id,old.id));
  if(!next?.connectsToOpeningId||!same(next.connectsToOpeningId,old.connectsToOpeningId))continue;
  if(freezeCanonical({dimensions:old.dimensions,offset:old.offset})===freezeCanonical({dimensions:next.dimensions,offset:next.offset}))continue;
  const pair=reciprocalDoorPair(after,next.id);
  for(const opening of pair)seen.add(opening.id.toLowerCase());
  assertDoorContents(after,pair);
 }
}
