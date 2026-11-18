// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {EXPERIENCE_NAMESPACE,experienceFor} from '@exhibitos/studio-contract';
import type {Pool} from 'pg';
import {expect,it} from 'vitest';
import {newDraft} from '../../web/src/drafts/example.ts';
import {newPlacement,syntheticArtwork} from '../../web/src/placement/model.ts';
import {buildApp} from './app.ts';
import {audioMedia,type AudioRow} from './audio.ts';
import {etag} from './studio.ts';

function pcm(){const bytes=Buffer.alloc(204);bytes.write('RIFF');bytes.writeUInt32LE(196,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(160,40);return bytes;}

it('binds one server-approved placement voice, preserving the head and requiring current authority, approval and PCM bytes',async()=>{
 const rights={holder:'Synthetic owner',ownership:'owner' as const,licenseId:'CC0-1.0',permissions:{display:true,export:true,download:false,commercial:false},creditLine:'Synthetic voice'};
 const draft=newDraft(),tenantId=randomUUID(),userId=randomUUID(),csrf='voice-test',token='c'.repeat(43),revision=3;
 const artwork=syntheticArtwork(),placement=newPlacement(artwork,draft.candidate.rooms[0]!.id);
 draft.candidate.artworks.push(artwork);draft.candidate.placements.push(placement);
 draft.candidate.accessibility.artworkDescriptions.push({placementId:placement.id,text:'Synthetic artwork'});
 draft.candidate.extensions={...draft.candidate.extensions,'org.example.test/keep':{value:[1,2,3]}};
 let bytes=pcm(),row:AudioRow={tenant_id:tenantId,exhibition_id:draft.exhibitionId,id:randomUUID(),created_by:userId,sha256:sha256(bytes),bytes:bytes.length,mime:'audio/wav',rights,object_key:'synthetic/voice',state:'approved',revoked:false,duration_seconds:.01};
 let approval:unknown=audioMedia(row),studioOwner=userId,live=true,database=true;
 const queries:{sql:string;args:unknown[]|undefined}[]=[],session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string,args?:unknown[])=>{queries.push({sql,args});
  if(sql.includes('SELECT s.*,m.role'))return {rows:[session],rowCount:1};
  if(sql.startsWith('SELECT id,revision,metadata,studio_owner_user_id FROM exhibitions'))return {rows:[{id:draft.exhibitionId,revision,metadata:draft,studio_owner_user_id:studioOwner}],rowCount:1};
  if(sql.startsWith('SELECT * FROM studio_audio'))return {rows:args?.[0]===row.tenant_id&&args?.[1]===row.exhibition_id&&args?.[2]===row.id?[row]:[],rowCount:1};
  if(sql.startsWith('SELECT snapshot FROM audio_approvals'))return {rows:approval?[{snapshot:approval}]:[],rowCount:approval?1:0};
  if(/^\s*(INSERT|UPDATE)/.test(sql))return {rows:[{}],rowCount:1};
  return {rows:[],rowCount:0};},release:()=>{}};
 const owner={tenantId,principalId:userId,workspaceId:randomUUID(),assertDatabase:async()=>{if(!database)throw Error('DATABASE_UNAVAILABLE');},assertRecord:async()=>{}} as never;
 const auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 const app=buildApp({pool:{connect:async()=>client} as unknown as Pool,auth,blobs:{get:async()=>bytes} as unknown as BlobStore,nativeOexWorkspace:owner,nativeBoundedEditing:true,runtimeAvailable:()=>live});
 const path=`/api/v1/tenants/${tenantId}/studio/exhibitions/${draft.exhibitionId}`,binding={version:1,epoch:randomUUID(),sequence:1,tenantId,principalId:userId,requestId:randomUUID()};
 const command=()=>({...binding,type:'set-placement-voice',placementId:placement.id,audioId:row.id,locale:'ko-KR',transcript:'Synthetic transcript',expectedMediaAsset:audioMedia(row)});
 const headers=()=>({host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf,'if-match':etag(revision,draft)});
 const post=(request:unknown=command(),override:Record<string,string>={},expectedRevision=revision)=>app.inject({method:'POST',url:path+'/native-authoring-proposal',headers:{...headers(),...override},payload:{expectedRevision,request}});
 const rejected=async()=>{const r=await post();expect(r.statusCode,r.body).toBe(422);};
 try{
  const before=structuredClone(draft),reply=await post();expect(reply.statusCode,reply.body).toBe(200);
  const next=reply.json().candidate,expected=structuredClone(before.candidate),experience=experienceFor(expected);
  experience.voices.push({placementId:placement.id,assetId:row.id,locale:'ko-KR',transcript:'Synthetic transcript'});
  expected.mediaAssets.push(audioMedia(row));expected.extensions={...expected.extensions,[EXPERIENCE_NAMESPACE]:experience} as unknown as typeof expected.extensions;
  expect(reply.json()).toEqual({...binding,placementId:placement.id,candidate:expected});expect(reply.headers.etag).toBe(etag(revision,draft));expect(draft).toEqual(before);
  expect((await post()).json()).toEqual(reply.json());
  expect(queries.some(q=>/^(INSERT|UPDATE)/.test(q.sql))).toBe(false);
  expect((await post(command(),{'x-csrf-token':''})).statusCode).toBe(403);
  expect((await post(command(),{'if-match':etag(revision-1,draft)})).statusCode).toBe(412);
  expect((await post(command(),{},revision-1)).statusCode).toBe(412);
  expect((await post({...command(),principalId:randomUUID()})).statusCode).toBe(403);
  expect((await post({...command(),tenantId:randomUUID()})).statusCode).toBe(403);
  session.role='viewer';expect((await post()).statusCode).toBe(403);session.role='admin';
  expect((await post({...command(),expectedMediaAsset:{...audioMedia(row),extra:true}})).statusCode).toBe(422);
  studioOwner=randomUUID();expect((await post()).statusCode).toBe(403);studioOwner=userId;
  live=false;expect((await post()).statusCode).toBe(503);live=true;
  database=false;expect((await post()).statusCode).toBe(500);database=true;
  expect((await post({...command(),placementId:randomUUID()})).statusCode).toBe(422);
  expect((await post({...command(),audioId:randomUUID()})).statusCode).toBe(422);
  expect((await post({...command(),candidate:next})).statusCode).toBe(400);
  expect((await post({...command(),sequence:0})).statusCode).toBe(400);
  expect((await post(command(),{'if-match':''})).statusCode).toBe(400);
  expect((await post({...command(),transcript:'  '})).statusCode).toBe(422);
  expect((await post({...command(),transcript:'x'.repeat(16385)})).statusCode).toBe(400);
  expect((await post({...command(),locale:'ko_KR'})).statusCode).toBe(400);
  const validRow=structuredClone(row),validBytes=Buffer.from(bytes),validApproval=structuredClone(approval);
  for(const changes of [{state:'validated' as const},{revoked:true},{exhibition_id:randomUUID()},{tenant_id:randomUUID()},{rights:{...rights,permissions:{...rights.permissions,export:false}}},{rights:{...rights,permissions:{...rights.permissions,display:false}}},{rights:{...rights,expiresAt:'2000-01-01T00:00:00Z'}},{rights:{...rights,validFrom:'2099-01-01T00:00:00Z'}}]){row={...validRow,...changes};await rejected();}row=validRow;
  approval=null;await rejected();approval={...audioMedia(row),bytes:999};await rejected();approval=validApproval;
  expect((await post({...command(),expectedMediaAsset:{...audioMedia(row),sha256:'f'.repeat(64)}})).statusCode).toBe(422);
  expect((await post({...command(),expectedMediaAsset:{...audioMedia(row),rights:{...rights,permissions:{...rights.permissions,download:true}}}})).statusCode).toBe(422);
  bytes=Buffer.from(validBytes);bytes[100]=1;await rejected();bytes=validBytes;
  bytes=Buffer.from(validBytes);bytes.writeUInt16LE(3,20);row={...row,sha256:sha256(bytes)};approval=audioMedia(row);await rejected();bytes=validBytes;row=validRow;approval=validApproval;
  // Reuse the exact row; locale matching is case-insensitive and replaces in place.
  draft.candidate=structuredClone(next);
  const replacement=await post({...command(),locale:'KO-kr',transcript:'Updated transcript'});expect(replacement.statusCode,replacement.body).toBe(200);
  const replaced=replacement.json().candidate;expect(replaced.mediaAssets).toEqual(next.mediaAssets);expect(experienceFor(replaced).voices).toEqual([{placementId:placement.id,assetId:row.id,locale:'KO-kr',transcript:'Updated transcript'}]);
  draft.candidate.mediaAssets[0]!.sha256='e'.repeat(64);await rejected();draft.candidate=structuredClone(next);
  draft.candidate.mediaAssets.push({...audioMedia(row),id:row.id.toUpperCase()});expect((await post()).statusCode).toBe(409);draft.candidate=structuredClone(next);
  const full=experienceFor(draft.candidate);full.voices=Array.from({length:64},(_,i)=>({placementId:placement.id,assetId:row.id,locale:`en-${i}`,transcript:`Other transcript ${i}`}));
  full.audioDefaults={soundOn:false};full.rooms=[{roomId:placement.roomId,reverb:.2}];full.translations=[{placementId:placement.id,locale:'fr',title:'Other title',description:'Other description'}];
  draft.candidate.extensions={...draft.candidate.extensions,[EXPERIENCE_NAMESPACE]:full} as unknown as typeof draft.candidate.extensions;
  await rejected();
  const fullReply=await post({...command(),locale:'EN-0'});expect(fullReply.statusCode,fullReply.body).toBe(200);
  const fullExperience=experienceFor(fullReply.json().candidate);expect(fullExperience.voices).toHaveLength(64);expect(fullExperience.voices.slice(1)).toEqual(full.voices.slice(1));
  expect({...fullExperience,voices:[]}).toEqual({...full,voices:[]});
  draft.candidate=structuredClone(next);
  // Current ordinary Save already admits the exact returned proposal; it still requires CAS.
  const save=await app.inject({method:'PUT',url:path,headers:headers(),payload:{requestId:randomUUID(),draft:{...draft,candidate:replaced}}});expect(save.statusCode,save.body).toBe(200);expect(save.json().revision).toBe(revision+1);expect(save.json().draft.candidate).toEqual(replaced);
  expect(queries.filter(q=>q.sql.startsWith('UPDATE exhibitions'))).toHaveLength(1);
 }finally{await app.close();}
});
