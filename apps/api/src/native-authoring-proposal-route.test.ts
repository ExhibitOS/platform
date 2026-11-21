// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {sha256} from '@exhibitos/storage';
import {architecturalSolids,PAIRED_WALL_STRUCTURE_NAMESPACE,PAIRED_WALL_STRUCTURE_PROFILE,validateArchitecturalFinishes} from '@exhibitos/studio-contract';
import {projectPublication} from './publication.ts';
import {remapOex} from './oex.ts';
import {addRoomSupplementalCeilingFill,ensureOrdinaryRoomBaseLight,LIGHT_DETAILS_NAMESPACE,ROOM_SUPPLEMENTAL_CEILING_FILL_PROFILE,ROOM_CEILING_FILL_PROFILE,ROOM_CEILING_FILL_ROOM_LOCAL_PROFILE,spaceLightingFor,setSpaceLighting,ensureRoomBaseLight,INSTALLATION_NAMESPACE,installationFor,lightDetailsFor,setLightDetails,applyArchitecturalFinishCommand,applyPlaqueCommand,applyFurnishingWalkingCollisionOverride,reconcileFurnishingWalkingCollision,FURNISHING_WALKING_COLLISION_NAMESPACE} from '@exhibitos/studio-contract';
import type {Pool} from 'pg';
import {expect,it} from 'vitest';
import {newDraft} from '../../web/src/drafts/example.ts';
import {newLight,newPlacement,syntheticArtwork} from '../../web/src/placement/model.ts';
import {newRoom,whiteCubeSurfaces} from '../../web/src/geometry/model.ts';
import {buildApp} from './app.ts';
import {etag} from './studio.ts';
import {readInstalledFurnishing} from './furnishing-assets.ts';

it('proposes and extends a reciprocal door pair only on the authenticated ordinary saved head',async()=>{
 const draft=newDraft(),left=draft.candidate.rooms[0]!;
 const right=newRoom('Adjacent gallery',{width:11,height:4,depth:8},
  {position:[(left.dimensions.width+11)/2,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
 draft.candidate.rooms.push(right);
 const leftSurfaces=whiteCubeSurfaces(left),rightSurfaces=whiteCubeSurfaces(right);
 draft.candidate.surfaces=[...leftSurfaces,...rightSurfaces];
 const leftWall=leftSurfaces.find(row=>row.type==='wall'&&row.transform.position[0]===left.dimensions.width/2)!;
 const rightWall=rightSurfaces.find(row=>row.type==='wall'&&row.transform.position[0]===-right.dimensions.width/2)!;
 const tenantId=randomUUID(),userId=randomUUID(),csrf='door-pair-csrf',token='a'.repeat(43);
 const session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:sha256(Buffer.from(csrf)),
  csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 let revision=3,ownerUserId=userId;
 const writes:string[]=[];
 const client={query:async(sql:string)=>{
  if(/^(INSERT|UPDATE|DELETE)/.test(sql))writes.push(sql);
  if(sql.includes('SELECT s.*,m.role'))return {rows:[session],rowCount:1};
  if(sql.startsWith('SELECT id,revision,metadata,studio_owner_user_id FROM exhibitions'))
   return {rows:[{id:draft.exhibitionId,revision,metadata:draft,studio_owner_user_id:ownerUserId}],rowCount:1};
  return {rows:[],rowCount:0};
 },release:()=>{}};
 const pool={connect:async()=>client} as unknown as Pool;
 const auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 const owner={tenantId,principalId:userId,workspaceId:randomUUID(),assertDatabase:async()=>{},assertRecord:async()=>{}} as never;
 const app=buildApp({pool,auth,nativeOexWorkspace:owner,nativeBoundedEditing:true,runtimeAvailable:()=>true});
 const url=`/api/v1/tenants/${tenantId}/studio/exhibitions/${draft.exhibitionId}/native-authoring-proposal`;
 const headers={host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf};
 const binding={version:1,epoch:randomUUID(),sequence:1,tenantId,principalId:userId,requestId:randomUUID()};
 const command={...binding,type:'add-connected-door-pair',dimensions:{width:2.4,height:3},
  first:{surfaceId:leftWall.id,offset:[0,(3-left.dimensions.height)/2]},
  second:{surfaceId:rightWall.id,offset:[0,(3-right.dimensions.height)/2]}};
 const post=(request:unknown,match=etag(revision,draft))=>app.inject({method:'POST',url,headers:{...headers,'if-match':match},
  payload:{expectedRevision:revision,request}});
 try{
  const original=structuredClone(draft.candidate),match=etag(revision,draft);
  const advertised=await app.inject({method:'GET',url:'/api/v1/auth/session',headers});
  expect(advertised.json()).toMatchObject({nativeDoorPairAuthoringProfile:'saved-head-rectangular-door-pair-v1',nativePairedWallStructureProfile:PAIRED_WALL_STRUCTURE_PROFILE});
  expect((await post(command,etag(revision-1,draft))).statusCode).toBe(412);
  ownerUserId=randomUUID();
  expect((await post(command)).statusCode).toBe(403);
  ownerUserId=userId;
  expect((await post({...command,second:{...command.second,surfaceId:leftWall.id}})).statusCode).toBe(422);
  expect((await post({...command,second:{...command.second,offset:[.2,command.second.offset[1]]}})).statusCode).toBe(422);
  expect((await post({...command,dimensions:{width:32,height:3}})).statusCode).toBe(422);
  const response=await post(command);
  expect(response.statusCode,response.body).toBe(200);
  expect(response.headers.etag).toBe(match);
  const proposal=response.json();
  const [first,second]=proposal.openingIds;
  expect(first).not.toBe(second);
  expect(proposal.candidate).toEqual({...original,openings:[...original.openings,
   {...command.first,id:first,type:'door',dimensions:command.dimensions,connectsToOpeningId:second},
   {...command.second,id:second,type:'door',dimensions:command.dimensions,connectsToOpeningId:first}]});
  expect((await post(command)).json()).toEqual(proposal);
  expect(draft.candidate).toEqual(original);
  revision++;
  draft.candidate=proposal.candidate;
  expect((await post({...command,requestId:randomUUID()},match)).statusCode).toBe(412);
  expect((await post({...command,requestId:randomUUID()})).statusCode).toBe(422);

  for (const wall of [leftWall,rightWall]) {
    draft.candidate=applyArchitecturalFinishCommand(draft.candidate,{type:'set-wall-finish',wall:{
      surfaceId:wall.id,preset:'plain',depth:.12,baseboardHeight:.04,trimWidth:.02,ceilingBand:false,
    }});
  }
  const before=structuredClone(draft.candidate), rightPair={openingId:second,peerOpeningId:first};
  const extent={...rightPair,side:'positive-normal' as const,extensionMeters:.11};
  const add={...binding,...extent,type:'set-paired-wall-structure',requestId:randomUUID()};
  expect((await post(add,match)).statusCode).toBe(412);
  expect((await post({...add,side:'negative-normal'})).statusCode).toBe(422);
  expect((await post({...add,peerOpeningId:second})).statusCode).toBe(422);
  const extended=await post(add);
  expect(extended.statusCode,extended.body).toBe(200);
  const applied=extended.json().candidate as typeof before;
  expect(applied).toEqual({...before,extensions:{...before.extensions,[PAIRED_WALL_STRUCTURE_NAMESPACE]:{version:1,pairs:[extent]}}});
  expect(draft.candidate).toEqual(before);
  const wallSolids=architecturalSolids(applied).filter(s=>s.surfaceId===rightWall.id);
  const oldMax=Math.max(...architecturalSolids(before).filter(s=>s.surfaceId===rightWall.id).flatMap(s=>s.vertices.map(v=>v[0])));
  expect(Math.max(...wallSolids.flatMap(s=>s.vertices.map(v=>v[0])))-oldMax).toBeCloseTo(.11);
  const through:[number,number,number]=[oldMax-.12,1,0], opposite:[number,number,number]=[oldMax+.66,1,0];
  expect(wallSolids.some(s=>s.collision.hit(through,opposite,.25))).toBe(false);
  for(const output of [remapOex(applied).exhibition,projectPublication(applied,[],new Date().toISOString()).snapshot]){
    expect(validateArchitecturalFinishes(output).valid).toBe(true);
    const {pairs}=output.extensions![PAIRED_WALL_STRUCTURE_NAMESPACE] as unknown as {pairs:(typeof extent)[]};
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.openingId).not.toBe(second);
    expect(output.openings.find(o=>o.id===pairs[0]!.openingId)?.connectsToOpeningId).toBe(pairs[0]!.peerOpeningId);
    expect(pairs[0]!.extensionMeters).toBe(.11);
  }
  draft.candidate=applied;
  revision++;
  const removed=await post({...binding,...rightPair,type:'remove-paired-wall-structure',requestId:randomUUID()});
  expect(removed.statusCode,removed.body).toBe(200);
  expect(removed.json().candidate).toEqual(before);
  expect(writes).toEqual([]);
 }finally{await app.close();}
});

it('proposes only a checked change to the current saved draft through the installed owner session',async()=>{
 const draft=newDraft(),tenantId=randomUUID(),userId=randomUUID(),csrf='test-csrf',token='a'.repeat(43);
 draft.candidate.surfaces=whiteCubeSurfaces(draft.candidate.rooms[0]!);
 const artwork=syntheticArtwork(),placement=newPlacement(artwork,draft.candidate.rooms[0]!.id);
 draft.candidate.artworks.push(artwork);draft.candidate.placements.push(placement);
 draft.candidate.accessibility.artworkDescriptions.push({placementId:placement.id,text:'Synthetic sculpture'});
 const originalLight=newLight(placement.roomId,'spot');originalLight.transform.position=[0,3,1];
 draft.candidate.lights.push(originalLight);
 draft.candidate.extensions={...draft.candidate.extensions,[INSTALLATION_NAMESPACE]:{version:1,placements:[{placementId:placement.id,frame:{kind:'none'}}]}};
 const revision=3,match=etag(revision,draft),queries:string[]=[];
 const session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>{
  queries.push(sql);
  if(sql.includes('SELECT s.*,m.role'))return {rows:[session],rowCount:1};
  if(sql.startsWith('SELECT id,revision,metadata,studio_owner_user_id FROM exhibitions'))return {rows:[{id:draft.exhibitionId,revision,metadata:draft,studio_owner_user_id:userId}],rowCount:1};
  return {rows:[],rowCount:0};
 },release:()=>{}};
 const pool={connect:async()=>client} as unknown as Pool;
 const auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 const owner={tenantId,principalId:userId,workspaceId:randomUUID(),assertDatabase:async()=>{},assertRecord:async()=>{}} as never;
 let live=true;
 const app=buildApp({pool,auth,nativeOexWorkspace:owner,nativeBoundedEditing:true,runtimeAvailable:()=>live}),ordinary=buildApp({pool,auth});
 const url=`/api/v1/tenants/${tenantId}/studio/exhibitions/${draft.exhibitionId}/native-authoring-proposal`;
 const headers={host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf,'if-match':match};
 const binding={version:1,epoch:randomUUID(),sequence:1,tenantId,principalId:userId,requestId:randomUUID()};
 const roomId=draft.candidate.rooms[0]!.id;
 const plaque={type:'add-plaque' as const,plaque:{id:randomUUID(),roomId,source:{kind:'room' as const},position:[0,1.5,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],dimensions:{width:.6,height:.3},visible:true},roomIntroductionText:'An introduction'};
 const wall={type:'set-wall-finish' as const,wall:{surfaceId:draft.candidate.surfaces.find(s=>s.type==='wall')!.id,depth:.12,preset:'painted-edge' as const,trimWidth:.04,baseboardHeight:.1,ceilingBand:true}};
 const payload={expectedRevision:revision,request:{...binding,...plaque}};
 const post=(value:unknown,override:Record<string,string>={})=>app.inject({method:'POST',url,headers:{...headers,...override},payload:value as object});
 const before=structuredClone(draft);
 try{
  const response=await app.inject({method:'GET',url:'/api/v1/auth/session',headers});
  expect(response.json()).toMatchObject({roomBaseLightPlacementProfile:'room-base-light-placement-v1',roomCeilingFillProfile:ROOM_CEILING_FILL_PROFILE,roomSupplementalCeilingFillProfile:ROOM_SUPPLEMENTAL_CEILING_FILL_PROFILE,nativeAuthoringProposalProfile:'saved-head-v1',nativeSceneAuthoringProposalProfile:'saved-head-scene-v1',nativeFixtureAuthoringProposalProfile:'saved-head-fixture-v1',nativeLightObjectAuthoringProposalProfile:'saved-head-light-object-v1'});
  expect((await ordinary.inject({method:'POST',url,headers,payload})).statusCode).toBe(404);
  expect((await post(payload,{'x-csrf-token':''})).statusCode).toBe(403);
  expect((await post({...payload,expectedRevision:revision-1})).statusCode).toBe(412);
  expect((await post(payload,{'if-match':etag(revision-1,draft)})).statusCode).toBe(412);
  expect((await post({...payload,request:{...payload.request,principalId:randomUUID()}})).statusCode).toBe(403);
  expect((await post({...payload,candidate:draft.candidate})).statusCode).toBe(400);
  expect((await post({...payload,request:{...binding,...wall,wall:{...wall.wall,depth:200}}})).statusCode).toBe(422);
  const plaqueReply=await post(payload);
  expect(plaqueReply.statusCode,plaqueReply.body).toBe(200);
  expect(plaqueReply.headers.etag).toBe(match);
  expect(plaqueReply.json()).toEqual({...binding,plaqueId:plaque.plaque.id,candidate:applyPlaqueCommand(before.candidate,plaque)});
  const wallReply=await post({...payload,request:{...binding,...wall}});
  expect(wallReply.statusCode,wallReply.body).toBe(200);
  expect(wallReply.json()).toEqual({...binding,surfaceId:wall.wall.surfaceId,candidate:applyArchitecturalFinishCommand(before.candidate,wall)});
  const plain={type:'set-wall-finish' as const,wall:{...wall.wall,preset:'plain' as const,baseboardHeight:.04,plainBaseboard:true}},plainPayload={...payload,request:{...binding,...plain}};
  const plainReply=await post(plainPayload);expect(plainReply.statusCode,plainReply.body).toBe(200);
  expect(plainReply.json()).toEqual({...binding,surfaceId:plain.wall.surfaceId,candidate:applyArchitecturalFinishCommand(before.candidate,plain)});
  expect((await post(plainPayload)).json()).toEqual(plainReply.json());expect((await post({...plainPayload,expectedRevision:revision-1})).statusCode).toBe(412);
  for(const fields of [{plainBaseboard:'true'},{plainBaseboard:true,preset:'painted-edge'},{plainBaseboard:true,extra:true}])expect((await post({...plainPayload,request:{...binding,...plain,wall:{...plain.wall,...fields}}})).statusCode).toBe(422);
  for(const priorPlain of [false,true])for(const unrelated of [false,true]){
   let withOverrides=applyFurnishingWalkingCollisionOverride(applyArchitecturalFinishCommand(before.candidate,priorPlain?plain:wall),{kind:'baseboard',id:wall.wall.surfaceId},true);
   if(unrelated)withOverrides=applyFurnishingWalkingCollisionOverride(withOverrides,{kind:'light',id:originalLight.id},false);
   draft.candidate=withOverrides;const overrideHead=etag(revision,draft),disabled={...plain,wall:{...plain.wall,plainBaseboard:false}},cleanupPayload={...payload,request:{...binding,...disabled}};
   const cleaned=await post(cleanupPayload,{'if-match':overrideHead});expect(cleaned.statusCode,cleaned.body).toBe(200);
   expect(cleaned.json().candidate).toEqual(reconcileFurnishingWalkingCollision(withOverrides,applyArchitecturalFinishCommand(withOverrides,disabled)));
   expect(cleaned.json().candidate.extensions[FURNISHING_WALKING_COLLISION_NAMESPACE]).toEqual(unrelated?{version:1,overrides:[{kind:'light',id:originalLight.id,enabled:false}]}:undefined);
   expect((await post(cleanupPayload,{'if-match':overrideHead})).json()).toEqual(cleaned.json());
  }
  draft.candidate=before.candidate;
  const pedestal={kind:'box' as const,position:[0,0,0] as [number,number,number],yaw:0,dimensions:{width:.65,depth:.65,height:.18},material:{preset:'paint' as const,color:'#F2F2F2',roughness:.7,metalness:0}};
  const pedestalPayload={...payload,request:{...binding,type:'set-pedestal',placementId:placement.id,pedestal}};
  const pedestalReply=await post(pedestalPayload);
  expect(pedestalReply.statusCode,pedestalReply.body).toBe(200);
  const pedestalCandidate=pedestalReply.json().candidate;
  expect(installationFor(pedestalCandidate,placement.id)).toEqual({placementId:placement.id,frame:{kind:'none'},pedestal});
  expect(pedestalReply.json()).toMatchObject({...binding,placementId:placement.id});
  expect(pedestalCandidate.artworks).toEqual(before.candidate.artworks);
  expect(pedestalCandidate.placements).toEqual(before.candidate.placements);
  expect((await post(pedestalPayload)).json()).toEqual(pedestalReply.json());
  expect((await post({...pedestalPayload,request:{...pedestalPayload.request,placementId:randomUUID()}})).statusCode).toBe(422);
  expect((await post({...pedestalPayload,request:{...pedestalPayload.request,pedestal:{...pedestal,dimensions:{...pedestal.dimensions,height:-1}}}})).statusCode).toBe(422);
  const createdLight=newLight(roomId,'spot');createdLight.transform.position=[1,3,1];createdLight.targetPlacementId=placement.id;
  const settings={fixture:'spot-can' as const,aim:{kind:'placement-center' as const},range:4.1,penumbra:.35};
  const createPayload={...payload,request:{...binding,type:'add-light',light:createdLight,settings}};
  const bareCreate=await post({...createPayload,request:{...createPayload.request,settings:{...settings,fixture:'none'}}});
  expect(bareCreate.statusCode).toBe(422);
  expect(bareCreate.json().code).toBe('LIGHT_FIXTURE_REQUIRED');
  const {id:createdId,...createdFields}=createdLight;
  const createdReply=await post(createPayload);
  expect(createdReply.statusCode,createdReply.body).toBe(200);
  expect(createdReply.json()).toEqual({...binding,lightId:createdLight.id,candidate:setLightDetails({...before.candidate,lights:[...before.candidate.lights,createdLight]},createdId,createdFields,settings)});
  expect((await post(createPayload)).json()).toEqual(createdReply.json());
  expect(createdReply.json().candidate.lights).toHaveLength(before.candidate.lights.length+1);
  expect((await post({...createPayload,request:{...createPayload.request,light:originalLight}})).statusCode).toBe(422);
  expect((await post({...createPayload,request:{...createPayload.request,settings:{...settings,lightId:createdLight.id}}})).statusCode).toBe(422);
  expect((await post({...createPayload,request:{...createPayload.request,light:{...createdLight,roomId:randomUUID()}}})).statusCode).toBe(422);
  const fill=ensureOrdinaryRoomBaseLight(before.candidate,roomId,randomUUID(),ROOM_CEILING_FILL_PROFILE);
  const fillLight=fill.lights.at(-1)!;
  const fillPayload={...payload,request:{...binding,type:'add-light',light:fillLight,
   settings:{fixture:'none',purpose:'room-base',basePlacement:'auto',ceilingFill:{version:1,brightness:0.5}}}};
  const fillReply=await post(fillPayload);
  expect(fillReply.statusCode,fillReply.body).toBe(200);
  expect(fillReply.json().candidate).toEqual(fill);
  expect(fillReply.json().candidate.lights[0]).toEqual(originalLight);
  expect((await post({...fillPayload,request:{...fillPayload.request,light:{...fillLight,intensity:fillLight.intensity+1}}})).statusCode).toBe(422);
  draft.candidate=fill;
  const fillHead=etag(revision,draft);
  const selectDefault={...payload,request:{...binding,type:'set-room-ceiling-fill-brightness',lightId:fillLight.id,brightness:.5,mode:'default'}};
  const markedReply=await post(selectDefault,{'if-match':fillHead});
  expect(markedReply.statusCode,markedReply.body).toBe(200);
  const marked=markedReply.json().candidate;
  expect(marked.lights).toEqual([originalLight,{...fillLight,intensity:5*fillLight.intensity}]);
  expect(lightDetailsFor(marked).at(-1)?.ceilingFill).toEqual({version:1,brightness:.5,mode:'default'});
  expect((await post({...selectDefault,request:{...selectDefault.request,brightness:.4}},{'if-match':fillHead})).statusCode).toBe(422);
  draft.candidate=marked;
  const markedHead=etag(revision,draft);
  const localSelection={...selectDefault,request:{...selectDefault.request,spaceLightingMode:'room-local'}};
  const roomLocal=await post(localSelection,{'if-match':markedHead});
  expect(roomLocal.statusCode,roomLocal.body).toBe(200);
  const localCandidate=roomLocal.json().candidate;
  expect(spaceLightingFor(localCandidate)).toEqual({version:1,baselineIntensity:0,reflectionIntensity:0,mode:'room-local'});
  expect(localCandidate.lights).toEqual(marked.lights);
  expect(lightDetailsFor(localCandidate)).toEqual(lightDetailsFor(marked));
  expect(draft.candidate).toEqual(marked);
  expect((await post(localSelection,{'if-match':fillHead})).statusCode).toBe(412);
  expect((await post({...localSelection,request:{...localSelection.request,principalId:randomUUID()}},{'if-match':markedHead})).statusCode).toBe(403);
  expect((await post({...localSelection,request:{...localSelection.request,spaceLightingMode:'future'}},{'if-match':markedHead})).statusCode).toBe(400);
  expect((await post({...localSelection,request:{...localSelection.request,brightness:0}},{'if-match':markedHead})).statusCode).toBe(422);
  draft.candidate=setSpaceLighting(marked,{version:1,baselineIntensity:0,reflectionIntensity:0});
  expect((await post(localSelection,{'if-match':etag(revision,draft)})).json().candidate).toEqual(draft.candidate);
  const negotiated=await app.inject({method:'GET',url:'/api/v1/auth/session',headers});
  expect(negotiated.json().nativeRoomCeilingFillRoomLocalProfile).toBe(ROOM_CEILING_FILL_ROOM_LOCAL_PROFILE);
  draft.candidate=marked;
  const {mode:_,...selectExplicit}=selectDefault.request;
  void _;
  const explicitReply=await post({...selectDefault,request:selectExplicit},{'if-match':etag(revision,draft)});
  expect(explicitReply.statusCode,explicitReply.body).toBe(200);
  expect(explicitReply.json().candidate).toEqual(fill);
  const basePoint=ensureRoomBaseLight(before.candidate,roomId);
  const basePointLight=basePoint.lights.at(-1)!;
  expect(lightDetailsFor(basePoint).at(-1)?.basePlacement).toBe('auto');
  const legacyBinding={lightId:basePointLight.id,fixture:'none',purpose:'room-base',range:10};
  draft.candidate={...basePoint,extensions:{...basePoint.extensions,[LIGHT_DETAILS_NAMESPACE]:{version:1,lights:[legacyBinding]}}};
  const legacyHead=etag(revision,draft),supplementalId=randomUUID();
  const supplemental={...payload,request:{...binding,type:'add-room-supplemental-ceiling-fill',roomId,baseLightId:basePointLight.id,lightId:supplementalId}};
  const supplementalReply=await post(supplemental,{'if-match':legacyHead});
  expect(supplementalReply.statusCode,supplementalReply.body).toBe(200);
  expect(supplementalReply.json()).toEqual({...binding,lightId:supplementalId,candidate:addRoomSupplementalCeilingFill(draft.candidate,roomId,basePointLight.id,supplementalId)});
  expect((await post({...supplemental,request:{...supplemental.request,baseLightId:originalLight.id}},{'if-match':legacyHead})).statusCode).toBe(422);
  expect((await post(supplemental)).statusCode).toBe(412);
  draft.candidate=before.candidate;
  const {id:originalId,...originalFields}=originalLight;
  const updatePayload={...payload,request:{...binding,type:'set-light-details',lightId:originalId,light:{...originalFields,intensity:100},settings:{fixture:'none'}}};
  const updateReply=await post(updatePayload);
  expect(updateReply.statusCode,updateReply.body).toBe(200);
  expect(updateReply.json().candidate.lights).toEqual([{...originalLight,intensity:100}]);
  expect(lightDetailsFor(updateReply.json().candidate)).toEqual([{lightId:originalId,fixture:'none'}]);
  for(const fields of [{roomId:randomUUID()},{castsShadow:'true'},{transform:{...originalFields.transform,scale:[2,2,2]}},{id:originalId}]){
   expect((await post({...updatePayload,request:{...updatePayload.request,light:{...updatePayload.request.light,...fields}}})).statusCode).toBe(422);
  }
  const shadowReply=await post({...updatePayload,request:{...updatePayload.request,light:{...updatePayload.request.light,castsShadow:true}}});
  expect(shadowReply.statusCode,shadowReply.body).toBe(200);expect(shadowReply.json().candidate.lights[0].castsShadow).toBe(true);
  expect((await post({...updatePayload,request:{...updatePayload.request,unrelated:true}})).statusCode).toBe(400);
  expect((await post(updatePayload,{'if-match':''})).statusCode).toBe(400);
  const fixturePayload={...payload,request:{...binding,type:'set-furnishing-visual',hostKind:'light',hostId:originalId,catalogId:'museum-track-spot',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}}};
  const fixtureReply=await post(fixturePayload);
  expect(fixtureReply.statusCode,fixtureReply.body).toBe(200);
  expect(Object.keys(fixtureReply.json()).sort()).toEqual([...Object.keys(binding),'candidate'].sort());
  expect(fixtureReply.json().candidate.lights).toEqual(before.candidate.lights);
  expect((await post(fixturePayload)).json()).toEqual(fixtureReply.json());
  const ceiling=draft.candidate.surfaces.find(surface=>surface.type==='ceiling')!;
  const attachmentPayload={...payload,request:{...binding,type:'set-light-attachment',lightId:originalId,attachment:{surfaceId:ceiling.id,anchor:[0,0],gap:.5}}};
  const attachmentReply=await post(attachmentPayload);
  expect(attachmentReply.statusCode,attachmentReply.body).toBe(200);
  expect(Object.keys(attachmentReply.json()).sort()).toEqual([...Object.keys(binding),'lightId','candidate'].sort());
  expect(attachmentReply.json().lightId).toBe(originalId);
  expect((await post(attachmentPayload)).json()).toEqual(attachmentReply.json());
  expect((await post({...attachmentPayload,request:{...attachmentPayload.request,attachment:{...attachmentPayload.request.attachment,surfaceId:wall.wall.surfaceId}}})).statusCode).toBe(422);
  for(const request of [{...fixturePayload.request,assetId:randomUUID()},{...fixturePayload.request,catalogId:'backless-oak-bench'},{...fixturePayload.request,hostKind:'bench'},{...attachmentPayload.request,attachment:null},{...attachmentPayload.request,attachment:{...attachmentPayload.request.attachment,extra:1}}])expect((await post({...payload,request})).statusCode).toBe(400);
  const objectPayload={...payload,request:{...binding,type:'set-light-object',lightId:originalId,light:originalFields,settings:{fixture:'none'},attachment:null}};
  const selectedPayload={...payload,request:{...binding,type:'set-light-fixture',lightId:originalId,visual:{catalogId:'museum-track-spot',catalogVersion:1,pose:fixturePayload.request.pose}}};
  const clonePayload={...payload,request:{...binding,type:'duplicate-light-object',lightId:originalId}};
  const removePayload={...payload,request:{...binding,type:'remove-light-object',lightId:originalId}};
  for(const value of [objectPayload,selectedPayload,removePayload]){
   const reply=await post(value);expect(reply.statusCode,reply.body).toBe(200);
   expect(Object.keys(reply.json()).sort()).toEqual([...Object.keys(binding),'lightId','candidate'].sort());
   expect(reply.headers.etag).toBe(match);expect(reply.json()).toMatchObject(binding);
   expect(reply.json().lightId).toBe(originalId);
   expect((await post(value)).json()).toEqual(reply.json());
  }
  const bareClone=await post(clonePayload);
  expect(bareClone.statusCode).toBe(422);
  expect(bareClone.json().code).toBe('LIGHT_FIXTURE_REQUIRED');
  draft.candidate=setLightDetails(before.candidate,originalId,originalFields,{fixture:'spot-can'});
  const cloneHeaders={'if-match':etag(revision,draft)};
  const clone=await post(clonePayload,cloneHeaders);
  expect(clone.statusCode,clone.body).toBe(200);
  expect(clone.json().lightId).not.toBe(originalId);
  expect((await post(clonePayload,cloneHeaders)).json()).toEqual(clone.json());
  draft.candidate=before.candidate;
  expect((await post({...selectedPayload,request:{...selectedPayload.request,visual:null}})).statusCode).toBe(200);
  const washerReply=await post({...selectedPayload,request:{...selectedPayload.request,visual:{catalogId:'museum-wallwasher',catalogVersion:1,pose:{position:[0,.106,.05],yaw:0,scale:1}}}});
  expect((await post({...fixturePayload,request:{...fixturePayload.request,catalogId:'museum-wallwasher'}})).statusCode).toBe(400);
  const washerRoot='assets/furnishings/exhibitos-authored-20261111/museum-wallwasher/';
  const [washerModel,washerNotice]=await Promise.all([
   readInstalledFurnishing(washerRoot+'model.glb',201724,'a4b66294c77e206a574905e12680148129f914d368add947f1c8831c64bf3f4d',undefined,true),
   readInstalledFurnishing(washerRoot+'LICENSE-NOTICE.txt',1115,'b40713d9c089649c71aeed2c8fced9d9274612ef376b77d19ab5f6becd5b0cf3',undefined,true),
  ]);
  if(washerModel&&washerNotice){
   expect(washerReply.statusCode,washerReply.body).toBe(200);
   expect(washerReply.json().candidate.extensions['org.exhibitos.studio/furnishing-visuals'].assets[0]).toMatchObject({catalogId:'museum-wallwasher',bytes:201724,provenance:{recipe:'omit-unused-tangent-v1'},rights:{notice:{bytes:1115}}});
  }else{
   expect(washerReply.statusCode,washerReply.body).toBe(422);
   expect(washerReply.json().code).toBe('LIGHT_FIXTURE_SOURCE_UNAVAILABLE');
  }
  expect((await post(clonePayload,{'x-csrf-token':''})).statusCode).toBe(403);
  expect((await post({...clonePayload,expectedRevision:revision-1})).statusCode).toBe(412);
  expect((await post(clonePayload,{'if-match':etag(revision-1,draft)})).statusCode).toBe(412);
  expect((await post({...clonePayload,request:{...clonePayload.request,principalId:randomUUID()}})).statusCode).toBe(403);
  expect((await post({...clonePayload,request:{...clonePayload.request,lightId:randomUUID()}})).statusCode).toBe(422);
  for(const request of [
   {...clonePayload.request,newLightId:randomUUID()},
   {...removePayload.request,sourceId:originalId},
   {...objectPayload.request,light:{...originalFields,id:originalId}},
   {...objectPayload.request,settings:{fixture:'none',lightId:originalId}},
   {...objectPayload.request,attachment:{...attachmentPayload.request.attachment,extra:1}},
   {...selectedPayload.request,visual:{...selectedPayload.request.visual,assetId:randomUUID()}},
   {...selectedPayload.request,visual:{...selectedPayload.request.visual,catalogId:'unadmitted-light'}},
  ])expect((await post({...payload,request})).statusCode).toBe(400);
  const originalCandidate=draft.candidate,automatic=ensureRoomBaseLight(originalCandidate,roomId),base=automatic.lights.find(l=>l.id!==originalId)!;
  const {id:baseId,...baseFields}=base;
  draft.candidate=setLightDetails(automatic,baseId,{...baseFields,intensity:0,transform:{...baseFields.transform,position:[1,2,0]}},{fixture:'none'});
  const restorePayload={...payload,request:{...binding,type:'set-room-base-light-placement',lightId:baseId,basePlacement:'auto'}};
  const restoreReply=await post(restorePayload,{'if-match':etag(revision,draft)});expect(restoreReply.statusCode,restoreReply.body).toBe(200);
  expect(restoreReply.json().candidate.lights.find((l:{id:string})=>l.id===baseId)).toMatchObject({intensity:0,transform:{position:[0,draft.candidate.rooms[0]!.dimensions.height*.9,0]}});
  expect(lightDetailsFor(restoreReply.json().candidate).find(d=>d.lightId===baseId)!.basePlacement).toBe('auto');
  expect((await post({...restorePayload,request:{...restorePayload.request,basePlacement:'inferred'}},{'if-match':etag(revision,draft)})).statusCode).toBe(400);
  expect((await post({...restorePayload,request:{...restorePayload.request,lightId:originalId}},{'if-match':etag(revision,draft)})).statusCode).toBe(422);
  expect((await post(restorePayload,{'if-match':etag(revision-1,draft)})).statusCode).toBe(412);
  draft.candidate=originalCandidate;
  const savedExtensions=draft.candidate.extensions;
  draft.candidate.extensions={...savedExtensions,'org.exhibitos.studio/furnishing-visuals':{version:1,assets:[],bindings:[{hostKind:'light',hostId:originalId,assetId:randomUUID(),pose:{position:[0,0,0],yaw:0,scale:1}}]}};
  const corruptReply=await post(clonePayload,{'if-match':etag(revision,draft)});
  expect(corruptReply.statusCode,corruptReply.body).toBe(409);expect(corruptReply.json()).toMatchObject({code:'DRAFT_CORRUPT'});
  draft.candidate.extensions=savedExtensions;
  live=false;
  expect((await app.inject({method:'GET',url:'/api/v1/auth/session',headers})).json()).not.toHaveProperty('nativeSceneAuthoringProposalProfile');
  expect((await post(updatePayload)).statusCode).toBe(503);
  expect((await post(fixturePayload)).statusCode).toBe(503);
  expect((await post(attachmentPayload)).statusCode).toBe(503);
  for(const value of [objectPayload,selectedPayload,clonePayload,removePayload])expect((await post(value)).statusCode).toBe(503);
  expect((await app.inject({method:'GET',url:'/api/v1/auth/session',headers})).json()).not.toHaveProperty('nativeLightObjectAuthoringProposalProfile');
  expect((await app.inject({method:'GET',url:'/api/v1/auth/session',headers})).json()).not.toHaveProperty('nativeFixtureAuthoringProposalProfile');
  live=true;
  expect(draft).toEqual(before);
  expect(queries.some(sql=>/^(INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
 }finally{await app.close();await ordinary.close();}
});

it('keeps prepared custody paths private and never treats an absent or mismatched model as ready',async()=>{
 const root='assets/furnishings/exhibitos-authored-20261111/museum-wallwasher/';
 for(const path of [root+'source.glb',root+'producer-receipt.json',root+'../model.glb',root.replace('museum-wallwasher/','unadmitted-light/')+'model.glb'])await expect(readInstalledFurnishing(path,1,'0'.repeat(64))).rejects.toMatchObject({status:404,code:'FURNISHING_UNAVAILABLE'});
 await expect(readInstalledFurnishing(root+'model.glb',1,'0'.repeat(64))).rejects.toMatchObject({status:409,code:'FURNISHING_INTEGRITY'});
});

it('keeps owner and CAS checks while proposing and saving twenty finished walls',async()=>{
 const draft=newDraft(),baseRoom=draft.candidate.rooms[0]!,tenantId=randomUUID(),userId=randomUUID(),csrf='wall-capacity-test',token='b'.repeat(43);
 draft.candidate.rooms=Array.from({length:6},(_,i)=>({...structuredClone(baseRoom),id:i===0?baseRoom.id:randomUUID(),transform:{...structuredClone(baseRoom.transform),position:[i*20,0,0]}}));
 draft.candidate.surfaces=draft.candidate.rooms.flatMap(whiteCubeSurfaces);draft.candidate.openings=[];
 const walls=draft.candidate.surfaces.filter(s=>s.type==='wall');
 for(const wall of walls.slice(0,20))draft.candidate=applyArchitecturalFinishCommand(draft.candidate,{type:'set-wall-finish',wall:{surfaceId:wall.id,preset:'plain',depth:.12,trimWidth:.02,baseboardHeight:.04,ceilingBand:false}});
 const revision=7,match=etag(revision,draft),queries:string[]=[];
 const session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'artist',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>{queries.push(sql);if(sql.includes('SELECT s.*,m.role'))return {rows:[session],rowCount:1};if(sql.startsWith('SELECT id,revision,metadata,studio_owner_user_id FROM exhibitions'))return {rows:[{id:draft.exhibitionId,revision,metadata:draft,studio_owner_user_id:userId}],rowCount:1};if(/^\s*(INSERT|UPDATE)/.test(sql))return {rows:[{}],rowCount:1};return {rows:[],rowCount:0};},release:()=>{}};
 const owner={tenantId,principalId:userId,workspaceId:randomUUID(),assertDatabase:async()=>{},assertRecord:async()=>{}} as never;
 const app=buildApp({pool:{connect:async()=>client} as unknown as Pool,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},nativeOexWorkspace:owner,nativeBoundedEditing:true});
 const path=`/api/v1/tenants/${tenantId}/studio/exhibitions/${draft.exhibitionId}`,headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf,'if-match':match};
 const binding={version:1,epoch:randomUUID(),sequence:1,tenantId,principalId:userId,requestId:randomUUID()},wall={surfaceId:walls[0]!.id,preset:'plain',depth:.14,trimWidth:.02,baseboardHeight:.04,ceilingBand:false};
 const payload={expectedRevision:revision,request:{...binding,type:'set-wall-finish',wall}},post=(value:unknown,overrides:Record<string,string>={})=>app.inject({method:'POST',url:path+'/native-authoring-proposal',headers:{...headers,...overrides},payload:value as object});
 try{
  expect((await post(payload,{'x-csrf-token':''})).statusCode).toBe(403);
  expect((await post({...payload,request:{...payload.request,principalId:randomUUID()}})).statusCode).toBe(403);
  expect((await post(payload,{'if-match':etag(revision-1,draft)})).statusCode).toBe(412);
  const reply=await post(payload);expect(reply.statusCode,reply.body).toBe(200);
  const next=reply.json().candidate;expect(next.rooms).toEqual(draft.candidate.rooms);expect(next.placements).toEqual(draft.candidate.placements);
  const rejected=await post({...payload,request:{...payload.request,wall:{...wall,surfaceId:walls[20]!.id}}});expect(rejected.statusCode,rejected.body).toBe(422);expect(rejected.json().code).toBe('AUTHORING_PROPOSAL_INVALID');
  expect(queries.some(sql=>sql.startsWith('UPDATE exhibitions'))).toBe(false);
  const saved=await app.inject({method:'PUT',url:path,headers,payload:{requestId:randomUUID(),draft:{...draft,candidate:next}}});expect(saved.statusCode,saved.body).toBe(200);expect(saved.json().revision).toBe(revision+1);expect(saved.json().draft.candidate).toEqual(next);
  expect(queries.filter(sql=>sql.startsWith('UPDATE exhibitions'))).toHaveLength(1);expect(queries.some(sql=>/INSERT INTO publications/.test(sql))).toBe(false);
 }finally{await app.close();}
});
