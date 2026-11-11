// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {newDraft} from '../../../apps/web/src/drafts/example.js';
import {applyLightObjectCommand,type LightObjectCommand} from './light-object.js';
import {applyFurnishingCommand,furnishingsFor,validateFurnishings,FURNISHING_NAMESPACE} from './furnishings.js';
import {lightDetailsFor,validateStudioLightDetails,LIGHT_DETAILS_NAMESPACE,type LightDetails,type ExhibitionLight} from './light-details.js';
import {lightAttachmentsFor,lightAttachmentPose,validateLightAttachments,LIGHT_ATTACHMENT_NAMESPACE} from './room-envelope.js';
import {TEMPLATE_NAMESPACE} from './architecture.js';
const id='a0000000-0000-4000-8000-000000000001',cloneId='a0000000-0000-4000-8000-000000000002',assetId='a0000000-0000-4000-8000-000000000003';
const pose=()=>({position:[0,2,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]});
function fixture(){
 const d=newDraft('Light domain').candidate,q=Math.SQRT1_2;d.surfaces=[{id:crypto.randomUUID(),roomId:d.rooms[0]!.id,type:'ceiling',dimensions:{width:12,height:8},transform:{position:[0,4,0],rotation:[q,0,0,q],scale:[1,1,1]}},{id:crypto.randomUUID(),roomId:d.rooms[0]!.id,type:'wall',dimensions:{width:12,height:4},transform:{position:[0,2,-4],rotation:[0,0,0,1],scale:[1,1,1]}}];d.lights=[{id,roomId:d.rooms[0]!.id,type:'spot',transform:pose(),color:[1,.8,.6],intensity:80,unit:'candela',castsShadow:false,beamAngle:.5}];
 d.extensions={'org.example/opaque':{text:'retain me'},[TEMPLATE_NAMESPACE]:{version:1,name:'Synthetic',creator:'Test',license:'CC0-1.0',source:'bundled:test',modified:false,profile:'oes-rectangles-v1'}};return d;
}
const fields=(l:ExhibitionLight)=>{const{id:_,...value}=l;void _;return structuredClone(value);};
const visual=()=>({catalogId:'museum-track-spot' as const,catalogVersion:1 as const,pose:{position:[0,.15,.0755] as [number,number,number],yaw:0,scale:1}});
function selected(){return applyLightObjectCommand(fixture(),{type:'set-light-fixture',lightId:id,visual:visual()},{newAssetId:assetId}).candidate;}
function valid(d:Exhibition){expect(validateFurnishings(d).valid).toBe(true);expect(validateStudioLightDetails(d).valid).toBe(true);expect(validateLightAttachments(d).valid).toBe(true);}
function set(d:Exhibition,settings:Omit<LightDetails,'lightId'>={fixture:'none'}):LightObjectCommand{return {type:'set-light-object',lightId:id,light:fields(d.lights[0]!),settings};}

it('selects an admitted spot visual with compatible fallback and preserves emitter/source/opaque fields atomically',()=>{
 const d=fixture(),before=structuredClone(d),r=applyLightObjectCommand(d,{type:'set-light-fixture',lightId:id.toUpperCase(),visual:visual()},{newAssetId:assetId});valid(r.candidate);expect(r.lightId).toBe(id);expect(d).toEqual(before);expect(r.candidate.lights).toEqual(d.lights);expect(lightDetailsFor(r.candidate)).toEqual([{lightId:id,fixture:'spot-can'}]);expect(furnishingsFor(r.candidate)!.assets[0]!.id).toBe(assetId);expect(r.candidate.extensions!['org.example/opaque']).toEqual(d.extensions!['org.example/opaque']);expect(r.candidate.extensions![TEMPLATE_NAMESPACE]).toMatchObject({modified:true});
});
it('unrelated edits with fixture:none preserve independent GLB; explicit visual:null removes it while retaining settings/emitter',()=>{
 const original=selected(),command=set(original,{fixture:'none',range:12,penumbra:.2,aim:{kind:'rotation'}});if(command.type!=='set-light-object')throw Error('test');command.light.intensity=123;
 const d=applyLightObjectCommand(original,command).candidate;expect(furnishingsFor(d)).toEqual(furnishingsFor(original));expect(lightDetailsFor(d)[0]!.fixture).toBe('none');const before=structuredClone(d);
 const r=applyLightObjectCommand(d,{type:'set-light-fixture',lightId:id,visual:null});valid(r.candidate);expect(d).toEqual(before);expect(r.candidate.lights).toEqual(d.lights);expect(lightDetailsFor(r.candidate)).toEqual(lightDetailsFor(d));expect(furnishingsFor(r.candidate)).toBeUndefined();
});
it('duplicates only one same-room light, remaps its typed bindings and shares the exact visual asset without changing order',()=>{
 const d=selected();const ceiling=d.surfaces.find(s=>s.type==='ceiling')!,attachment={surfaceId:ceiling.id,anchor:[0,0] as [number,number],gap:.4};d.lights[0]!.transform=lightAttachmentPose(ceiling,{...attachment,lightId:id});
 d.extensions![LIGHT_ATTACHMENT_NAMESPACE]={version:1,lights:[{...attachment,lightId:id}]};valid(d);const before=structuredClone(d),r=applyLightObjectCommand(d,{type:'duplicate-light-object',lightId:id},{newLightId:cloneId});valid(r.candidate);expect(d).toEqual(before);expect(r.lightId).toBe(cloneId);expect(r.candidate.lights).toEqual([...d.lights,{...d.lights[0],id:cloneId}]);expect(lightDetailsFor(r.candidate)).toEqual([...lightDetailsFor(d),{...lightDetailsFor(d)[0],lightId:cloneId}]);expect(lightAttachmentsFor(r.candidate)).toEqual([...lightAttachmentsFor(d),{...lightAttachmentsFor(d)[0],lightId:cloneId}]);expect(furnishingsFor(r.candidate)!.assets).toEqual(furnishingsFor(d)!.assets);expect(furnishingsFor(r.candidate)!.bindings.map(b=>b.assetId)).toEqual([assetId,assetId]);
});
it('deletes only target records and garbage-collects only the last visual asset user',()=>{
 let d=applyLightObjectCommand(selected(),{type:'duplicate-light-object',lightId:id},{newLightId:cloneId}).candidate;
 d=applyLightObjectCommand(d,{type:'remove-light-object',lightId:id}).candidate;valid(d);expect(d.lights.map(v=>v.id)).toEqual([cloneId]);expect(lightDetailsFor(d).map(v=>v.lightId)).toEqual([cloneId]);expect(furnishingsFor(d)!.assets.map(v=>v.id)).toEqual([assetId]);
 const r=applyLightObjectCommand(d,{type:'remove-light-object',lightId:cloneId});valid(r.candidate);expect(r.lightId).toBe(cloneId);expect(r.candidate.lights).toEqual([]);expect(lightDetailsFor(r.candidate)).toEqual([]);expect(furnishingsFor(r.candidate)).toBeUndefined();
});
it('GC preserves unrelated catalogue descriptors and their array order',()=>{
 let d=selected();const wall=d.surfaces.find(v=>v.type==='wall')!,openingId=crypto.randomUUID(),portalAssetId=crypto.randomUUID();d.openings.push({id:openingId,type:'door',surfaceId:wall.id,offset:[0,-.9],dimensions:{width:1.1,height:2.2}});
 d=applyFurnishingCommand(d,{type:'set-furnishing-visual',hostKind:'opening',hostId:openingId,catalogId:'gallery-open-portal',catalogVersion:1,pose:{position:[0,-2,0],yaw:0,scale:1}},{newAssetId:portalAssetId});const portal=furnishingsFor(d)!.assets[1]!;
 const r=applyLightObjectCommand(d,{type:'remove-light-object',lightId:id});expect(furnishingsFor(r.candidate)!.assets).toEqual([portal]);expect(furnishingsFor(r.candidate)!.bindings).toEqual(furnishingsFor(d)!.bindings.filter(b=>b.hostKind==='opening'));
});
it('preserves omitted attachment, detaches only explicitly, and never snaps an inconsistent supplied pose',()=>{
 const d=fixture(),ceiling=d.surfaces.find(s=>s.type==='ceiling')!,attachment={surfaceId:ceiling.id,anchor:[0,0] as [number,number],gap:.4};d.lights[0]!.transform=lightAttachmentPose(ceiling,{...attachment,lightId:id});d.extensions![LIGHT_ATTACHMENT_NAMESPACE]={version:1,lights:[{...attachment,lightId:id}]};valid(d);
 const unchanged=applyLightObjectCommand(d,set(d)).candidate;expect(lightAttachmentsFor(unchanged)).toEqual(lightAttachmentsFor(d));
 const moved=set(d);if(moved.type!=='set-light-object')throw Error('test');moved.light.transform.position=[1,2,0];const before=structuredClone(d);expect(()=>applyLightObjectCommand(d,moved)).toThrow();expect(d).toEqual(before);
 const detached=applyLightObjectCommand(d,{...moved,attachment:null}).candidate;valid(detached);expect(detached.lights[0]!.transform.position).toEqual([1,2,0]);expect(lightAttachmentsFor(detached)).toEqual([]);
 expect(()=>applyLightObjectCommand(d,{...moved,attachment})).toThrow();const good={...moved,light:{...moved.light,transform:lightAttachmentPose(ceiling,{...attachment,lightId:id})},attachment};valid(applyLightObjectCommand(d,good).candidate);
});
it('legacy absence remains absent when cloned or explicitly detached without an existing attachment',()=>{
 const d=fixture(),r=applyLightObjectCommand(d,{type:'duplicate-light-object',lightId:id},{newLightId:cloneId}).candidate;expect(r.extensions![LIGHT_DETAILS_NAMESPACE]).toBeUndefined();expect(r.extensions![LIGHT_ATTACHMENT_NAMESPACE]).toBeUndefined();expect(r.extensions![FURNISHING_NAMESPACE]).toBeUndefined();
 const command=set(d);if(command.type!=='set-light-object')throw Error('test');const detached=applyLightObjectCommand(d,{...command,attachment:null}).candidate;expect(detached.extensions![LIGHT_ATTACHMENT_NAMESPACE]).toBeUndefined();
});
it('rejects room-base duplication and preserves purpose on explicit edits and removal',()=>{
 const d=fixture();d.extensions![LIGHT_DETAILS_NAMESPACE]={version:1,lights:[{lightId:id,fixture:'none',purpose:'room-base'}]};const before=structuredClone(d);expect(()=>applyLightObjectCommand(d,{type:'duplicate-light-object',lightId:id},{newLightId:cloneId})).toThrow();expect(d).toEqual(before);expect(lightDetailsFor(applyLightObjectCommand(d,set(d)).candidate)[0]!.purpose).toBe('room-base');expect(applyLightObjectCommand(d,{type:'remove-light-object',lightId:id}).candidate.lights).toEqual([]);
});
it.each(['missing','new-id-absent','room','extension','case-collision'])('rejects missing/foreign/identity collision %s without input mutation',kind=>{
 const d=fixture(),before=structuredClone(d);if(kind==='extension')d.extensions!['org.example/another']={id:cloneId};const stored=structuredClone(d);
 const cmd:LightObjectCommand={type:'duplicate-light-object',lightId:kind==='missing'?crypto.randomUUID():id};const option=kind==='room'?d.rooms[0]!.id:kind==='case-collision'?id.toUpperCase():kind==='extension'?cloneId:undefined;
 expect(()=>applyLightObjectCommand(d,cmd,{newLightId:option})).toThrow();expect(d).toEqual(stored);expect(before.lights).toEqual(d.lights);
});
it('rejects unsupported destructive references, including unknown asset consumers, without generic UUID rewriting',()=>{
 for(const target of[id,assetId]){const d=selected();d.extensions!['org.example/reference']={lightId:target};const before=structuredClone(d);expect(()=>applyLightObjectCommand(d,{type:'remove-light-object',lightId:id})).toThrow('LIGHT_OBJECT_REFERENCED');if(target===assetId)expect(()=>applyLightObjectCommand(d,{type:'set-light-fixture',lightId:id,visual:null})).toThrow('LIGHT_OBJECT_REFERENCED');expect(d).toEqual(before);}
});
it.each([
 (d:Exhibition)=>{d.lights[0]!.transform.rotation=[0,0,0,2];},
 (d:Exhibition)=>{d.lights[0]!.intensity=NaN;},
 (d:Exhibition)=>{d.lights[0]!.unit='lux';},
 (d:Exhibition)=>{d.lights[0]!.transform.position=[100,2,0];},
 (d:Exhibition)=>{d.extensions![LIGHT_DETAILS_NAMESPACE]={version:1,lights:[{lightId:id,fixture:'panel'}]};},
])('rejects invalid input before applying any partial update',edit=>{const d=fixture();edit(d);const before=structuredClone(d);expect(()=>applyLightObjectCommand(d,{type:'remove-light-object',lightId:id})).toThrow();expect(d).toEqual(before);});
it('rejects incompatible/foreign mounts, unsupported catalogue, stale IDs and extra command keys atomically',()=>{
 const d=fixture(),before=structuredClone(d);expect(()=>applyLightObjectCommand(d,{type:'set-light-fixture',lightId:id,visual:{...visual(),catalogId:'backless-oak-bench'}})).toThrow();const point=fixture();point.lights[0]!.type='point';delete point.lights[0]!.beamAngle;expect(()=>applyLightObjectCommand(point,{type:'set-light-fixture',lightId:id,visual:visual()})).toThrow();
 const cmd=set(d);if(cmd.type!=='set-light-object')throw Error('test');expect(()=>applyLightObjectCommand(d,{...cmd,attachment:{surfaceId:crypto.randomUUID(),anchor:[0,0],gap:.2}})).toThrow();expect(()=>applyLightObjectCommand(d,{...cmd,extra:true} as unknown as LightObjectCommand)).toThrow();expect(()=>applyLightObjectCommand(d,{...cmd,light:{...cmd.light,roomId:crypto.randomUUID()}})).toThrow();expect(d).toEqual(before);
});

it('semantic no-ops preserve all source content/template flag and row order',()=>{
 for(const d of[fixture(),selected()]){
  const command=set(d,lightDetailsFor(d).length?{fixture:'spot-can'}:{fixture:'none'});
  // No detail row is an explicit new intent, so first install it.
  const source=applyLightObjectCommand(d,command).candidate;source.extensions![TEMPLATE_NAMESPACE]={...source.extensions![TEMPLATE_NAMESPACE] as object,modified:false};
  expect(applyLightObjectCommand(source,command).candidate).toEqual(source);
  if(furnishingsFor(source))expect(applyLightObjectCommand(source,{type:'set-light-fixture',lightId:id,visual:visual()}).candidate).toEqual(source);
  else expect(applyLightObjectCommand(source,{type:'set-light-fixture',lightId:id,visual:null}).candidate).toEqual(source);
 }
});

it('replaces attachment rows at their original index and preserves explicit same-mount no-op',()=>{
 let d=fixture();const ceiling=d.surfaces.find(s=>s.type==='ceiling')!,attachment={surfaceId:ceiling.id,anchor:[0,0] as [number,number],gap:.4};d.lights[0]!.transform=lightAttachmentPose(ceiling,{...attachment,lightId:id});d.extensions![LIGHT_ATTACHMENT_NAMESPACE]={version:1,lights:[{...attachment,lightId:id}]};d=applyLightObjectCommand(d,{type:'duplicate-light-object',lightId:id},{newLightId:cloneId}).candidate;
 const command=set(d);if(command.type!=='set-light-object')throw Error('test');d=applyLightObjectCommand(d,{...command,attachment}).candidate;d.extensions![TEMPLATE_NAMESPACE]={...d.extensions![TEMPLATE_NAMESPACE] as object,modified:false};
 expect(applyLightObjectCommand(d,{...command,attachment}).candidate).toEqual(d);
 const moved={...attachment,anchor:[1,0] as [number,number]};const next=applyLightObjectCommand(d,{...command,light:{...command.light,transform:lightAttachmentPose(ceiling,{...moved,lightId:id})},attachment:moved}).candidate;
 expect(lightAttachmentsFor(next).map(v=>v.lightId)).toEqual([id,cloneId]);expect(lightAttachmentsFor(next)[0]!.anchor).toEqual([1,0]);expect(lightAttachmentsFor(next)[1]).toEqual(lightAttachmentsFor(d)[1]);
});

it('rejects trusted new visual descriptor IDs colliding with global or extension identities',()=>{
 for(const where of['room','extension']){const d=fixture();if(where==='extension')d.extensions!['org.example/identity']={id:assetId};const before=structuredClone(d);expect(()=>applyLightObjectCommand(d,{type:'set-light-fixture',lightId:id,visual:visual()},{newAssetId:where==='room'?d.rooms[0]!.id:assetId})).toThrow('LIGHT_OBJECT_ID_COLLISION');expect(d).toEqual(before);}
});
