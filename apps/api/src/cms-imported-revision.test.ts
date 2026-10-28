// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,test,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {validateArtwork,type Artwork} from '@exhibitos/spec';
import {ARTWORK_DETAILS_NAMESPACE,DISPLAY_POLICY_NAMESPACE,LOD_NAMESPACE} from '@exhibitos/studio-contract';
import {sha256,type BlobStore} from '@exhibitos/storage';
import {Cms,type ArtworkMetadata} from './cms.ts';
import {ApiError,type Session} from './auth.ts';
import {projectPublication} from './publication.ts';
const witness=vi.hoisted(()=>({bytes:Buffer.from('synthetic selected primary bytes'),approvalId:'10000000-0000-4000-8000-000000000097'}));
// Synthetic approval/bytes with the existing decoder mocked: source tests only.
vi.mock('./approved-demo-display-files.ts',async original=>{
 const real=await original<typeof import('./approved-demo-display-files.ts')>(),{createHash}=await import('node:crypto'),model=real.APPROVED_DEMO_DISPLAY_FILES.find(e=>'canonicalMime'in e)!;
 return {...real,APPROVED_DEMO_DISPLAY_FILES:[...real.APPROVED_DEMO_DISPLAY_FILES,{...model,approvalId:witness.approvalId,canonicalAssetSha256:createHash('sha256').update(witness.bytes).digest('hex'),canonicalBytes:witness.bytes.length,canonicalTriangles:12}]};
});
vi.mock('./derivative.ts',()=>({derivative:vi.fn(async()=>Buffer.from('synthetic marked preview'))}));
afterEach(()=>vi.clearAllMocks());
const tenantId='10000000-0000-4000-8000-000000000001',id='10000000-0000-4000-8000-000000000002',assetId='10000000-0000-4000-8000-000000000003',artistId='10000000-0000-4000-8000-000000000004';
const session={tenantId,userId:'10000000-0000-4000-8000-000000000005',role:'artist'} as Session;
function setup(imported=true){
 const rights={holder:'Synthetic owner',ownership:'owner' as const,licenseId:'CC0-1.0',permissions:{display:true,download:false,export:false,commercial:false},creditLine:'Synthetic credit'};
 const metadata:ArtworkMetadata={title:'Original title',description:'Original description',medium:'marble',creationYear:1866,dimensions:{width:1,height:2,depth:.5,unit:'m'},rights,provenance:{source:'human-authored',sourceUnits:'m',scaleApplied:false,notes:'private notes'}};
 const artwork:Artwork={schemaVersion:'1.0.0-draft.1',kind:'artwork',id,revisionId:'10000000-0000-4000-8000-000000000006',revision:1,createdAt:'2026-01-01T00:00:00.000Z',metadata:{title:metadata.title,description:metadata.description,artist:'Synthetic artist',medium:'marble',language:'ko'},artworkType:'sculpture',units:'meter',coordinates:'right-handed-y-up',dimensions:{width:1,height:2,depth:.5},transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},primaryAssetId:assetId,assets:[{id:assetId,path:'imported/original/model.glb',role:'model',mime:'model/gltf-binary',bytes:witness.bytes.length,sha256:sha256(witness.bytes)}],rights:structuredClone(rights),provenance:{authorship:'human-authored',events:[{id:'10000000-0000-4000-8000-000000000007',type:'converted',at:'2026-01-01T00:00:00.000Z',description:'Preserved source and canonical conversion evidence'}]},extensions:{'org.exhibitos.studio/cms':{tenantId,artworkId:id,revision:1},[ARTWORK_DETAILS_NAMESPACE]:{version:1,creationYear:1866},[LOD_NAMESPACE]:{version:1,variants:[{assetId,detail:'full',triangles:12}]},[DISPLAY_POLICY_NAMESPACE]:{version:1,profile:'approved-open-access-demo-v1',approvalId:witness.approvalId,sourceAssetSha256:sha256(witness.bytes),rightsEvidenceSha256:'743fe23cd881176877ddd5cb425f80fd62a43efa46b539379429276f07cfa84a'}}};
 const article={id,artist_id:artistId,revision:1,approved_revision:1 as number|null,approved_asset_id:assetId as string|null,metadata:structuredClone(metadata),updated_at:'2026-01-01T00:00:00.000Z'};
 const asset={...artwork.assets[0]!,rights:structuredClone(rights),rights_id:'10000000-0000-4000-8000-000000000008',rights_revision:1,object_key:'private/synthetic-original'};
 type Approval={revision:number;created_at:string;snapshot:{metadata:ArtworkMetadata;asset:{id:string;sha256:string;bytes:number;mime:string;rightsRevision:number};importedArtwork?:Artwork}};
 const approvals=new Map<number,Approval>([[1,{revision:1,created_at:article.updated_at,snapshot:{metadata:structuredClone(metadata),asset:{id:assetId,sha256:asset.sha256,bytes:asset.bytes,mime:asset.mime,rightsRevision:1},...(imported?{importedArtwork:structuredClone(artwork)}:{})}}]]);
 const rows=(v:unknown[])=>({rows:v,rowCount:v.length});
 const query=vi.fn(async(sql:string,p:unknown[])=>{
  if(sql.startsWith('UPDATE artworks SET metadata=')){if(p[2]!==article.revision)return rows([]);article.metadata=structuredClone(p[3] as ArtworkMetadata);article.revision++;article.approved_revision=null;article.approved_asset_id=null;article.updated_at='2026-01-02T00:00:00.000Z';return rows([{revision:article.revision}]);}
  if(sql.startsWith('INSERT INTO artwork_revisions')||sql.startsWith('INSERT INTO audit_events')||sql.startsWith('INSERT INTO publication_events'))return rows([]);
  if(sql.startsWith('UPDATE rights SET metadata=')){asset.rights=structuredClone(p[2] as typeof rights);asset.rights_revision++;return rows([]);}
  if(sql.includes('a.id=ANY'))return rows([structuredClone(asset)]);
  if(sql.startsWith('SELECT a.*,r.metadata AS rights'))return rows(p[2]===asset.id?[structuredClone(asset)]:[]);
  if(sql.startsWith('SELECT revision,snapshot FROM artwork_approvals')){const r=[...approvals.values()].filter(a=>a.revision<=Number(p[2])).sort((a,b)=>b.revision-a.revision)[0];return rows(r?[structuredClone(r)]:[]);}
  if(sql.startsWith('SELECT metadata FROM asset_derivatives'))return rows([]);
  if(sql.startsWith('SELECT metadata FROM artists'))return rows([{metadata:{name:'Synthetic artist'}}]);
  if(sql.startsWith('SELECT snapshot FROM artwork_approvals')){const r=approvals.get(Number(p[2]));return rows(r?[structuredClone(r)]:[]);}
  if(sql.startsWith('INSERT INTO artwork_approvals')){approvals.set(Number(p[2]),{revision:Number(p[2]),created_at:article.updated_at,snapshot:structuredClone(p[4]) as Approval['snapshot']});return rows([]);}
  if(sql.startsWith('UPDATE artworks SET approved_revision=')){article.approved_revision=Number(p[2]);article.approved_asset_id=String(p[3]);return rows([]);}
  if(sql.startsWith('SELECT ap.snapshot')){const r=approvals.get(article.revision);return rows(article.approved_revision===article.revision&&r?[{...structuredClone(r),current_metadata:structuredClone(article.metadata),approved_asset_id:article.approved_asset_id}]:[]);}
  throw Error('UNEXPECTED_QUERY_'+sql);
 });
 const get=vi.fn(async()=>Buffer.from(witness.bytes)),cms=new Cms({get} as unknown as BlobStore),c={query} as unknown as PoolClient;
 // Actual membership/resource policy is unchanged; this unit exercises stateful
 // metadata CAS, server-owned lineage and approval/projection SQL boundaries.
 vi.spyOn(cms,'ownArtwork').mockImplementation(async(_c,s,requested)=>{if(s.tenantId!==tenantId||requested!==id)throw new ApiError(403,'FORBIDDEN');return structuredClone(article);});
 vi.spyOn(cms,'detail').mockImplementation(async()=>({revision:article.revision,approvedRevision:article.approved_revision}) as Awaited<ReturnType<Cms['detail']>>);
 vi.spyOn(cms,'display').mockImplementation(async()=>{if(article.approved_revision!==article.revision)throw new ApiError(409,'REVISION_NOT_APPROVED');return {artist:'Synthetic artist'} as Awaited<ReturnType<Cms['display']>>;});
 const revise=(change:Partial<ArtworkMetadata>={})=>cms.revise(c,session,id,{...structuredClone(article.metadata),...change,revision:article.revision});
 const approve=()=>cms.approve(c,session,id,{revision:article.revision,assetId});
 return {cms,c,query,get,article,asset,approvals,artwork,revise,approve};
}
test('normal text edit, approval and Studio/publication preserve exact imported assets, typed policy and provenance',async()=>{
 const h=setup(),old=structuredClone(h.approvals.get(1)!),privateNote='PRIVATE_EDIT_NOTE_SENTINEL_DO_NOT_PUBLISH';await h.revise({title:'Revised title',description:'Reviewed objective description',medium:'Marble sculpture',provenance:{...h.article.metadata.provenance,notes:privateNote}});
 await expect(h.cms.studioArtwork(h.c,session,id)).rejects.toMatchObject({code:'REVISION_NOT_APPROVED'});await h.approve();
 const a=(await h.cms.studioArtwork(h.c,session,id)).artwork;expect(validateArtwork(a).valid).toBe(true);expect(a.revision).toBe(2);expect(a.revisionId).not.toBe(h.artwork.revisionId);expect(a.metadata).toEqual({...h.artwork.metadata,title:'Revised title',description:'Reviewed objective description',medium:'Marble sculpture'});
 expect(a.assets).toEqual(h.artwork.assets);expect(a.rights).toEqual(h.artwork.rights);expect(a.dimensions).toEqual(h.artwork.dimensions);expect(a.transform).toEqual(h.artwork.transform);expect(a.extensions![DISPLAY_POLICY_NAMESPACE]).toEqual(h.artwork.extensions![DISPLAY_POLICY_NAMESPACE]);expect(a.extensions![LOD_NAMESPACE]).toEqual(h.artwork.extensions![LOD_NAMESPACE]);expect(a.extensions!['org.exhibitos.studio/cms']).toEqual({tenantId,artworkId:id,revision:2});expect(a.provenance.events.slice(0,-1)).toEqual(h.artwork.provenance.events);expect(a.provenance.events.at(-1)?.type).toBe('edited');expect(h.approvals.get(1)).toEqual(old);
 const {newDraft}=await import('../../web/src/drafts/example'),e=newDraft().candidate;e.artworks=[a];const projected=projectPublication(e,[{artwork:a,sourceAssetId:assetId,sourceSha256:sha256(witness.bytes),bytes:witness.bytes,mime:'model/gltf-binary',variants:{full:{triangles:12}}}],'2026-01-02T00:00:00.000Z').snapshot.artworks[0]!;
 expect(projected.metadata.description).toBe('Reviewed objective description');expect(projected.extensions![DISPLAY_POLICY_NAMESPACE]).toEqual(a.extensions![DISPLAY_POLICY_NAMESPACE]);expect(projected.assets[0]!.sha256).toBe(sha256(witness.bytes));expect(projected.extensions!['org.exhibitos.studio/cms']).toBeUndefined();expect(JSON.stringify(projected)).not.toContain('private notes');expect(JSON.stringify(projected)).not.toContain(privateNote);expect(JSON.stringify(a)).not.toContain(privateNote);expect(h.approvals.get(2)!.snapshot.metadata.provenance.notes).toBe(privateNote);
 const approved=structuredClone(h.approvals.get(2));await h.approve();expect(h.approvals.get(2)).toEqual(approved);
});
test('stale revisions, unapproved or substituted primaries and caller-supplied imported snapshots are rejected',async()=>{
 const stale=setup();await stale.revise();await expect(stale.cms.approve(stale.c,session,id,{revision:1,assetId})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
 const unknown=setup();await unknown.revise();await expect(unknown.cms.approve(unknown.c,session,id,{revision:2,assetId:crypto.randomUUID()})).rejects.toMatchObject({code:'ASSET_NOT_APPROVED'});
 const changed=setup();await changed.revise();changed.asset.id=crypto.randomUUID();await expect(changed.cms.approve(changed.c,session,id,{revision:2,assetId:changed.asset.id})).rejects.toMatchObject({code:'APPROVAL_INVALID'});
 const injected=setup();await expect(injected.cms.approve(injected.c,session,id,{revision:1,assetId,importedArtwork:injected.artwork} as {revision:number;assetId:string})).rejects.toMatchObject({code:'INVALID_INPUT'});
 for(const h of [stale,unknown,changed,injected])expect(h.approvals.has(2)).toBe(false);
});
test('imported approval never carries changed rights, dimensions, creation year or scale provenance silently',async()=>{
 for(const mutate of [(m:ArtworkMetadata)=>{m.dimensions.height=3;},(m:ArtworkMetadata)=>{(m.rights as {permissions:{download:boolean}}).permissions.download=true;},(m:ArtworkMetadata)=>{m.creationYear=2024;},(m:ArtworkMetadata)=>{m.provenance.sourceUnits='cm';},(m:ArtworkMetadata)=>{m.provenance.scaleApplied=true;}]){
  const h=setup(),m=structuredClone(h.article.metadata);mutate(m);await h.revise(m);await expect(h.approve()).rejects.toMatchObject({code:'APPROVAL_INVALID'});expect(h.approvals.has(2)).toBe(false);expect(h.article.approved_revision).toBeNull();
 }
 const revoked=setup(),m=structuredClone(revoked.article.metadata);(m.rights as {permissions:{display:boolean}}).permissions.display=false;await revoked.revise(m);await expect(revoked.approve()).rejects.toMatchObject({code:'RIGHTS_DENIED'});
});
test('foreign actor, wrong bound tenant/artwork and changed declared or stored bytes fail closed',async()=>{
 const actor=setup();await expect(actor.cms.approve(actor.c,{...session,tenantId:crypto.randomUUID()},id,{revision:1,assetId})).rejects.toMatchObject({code:'FORBIDDEN'});expect(actor.query).not.toHaveBeenCalled();
 for(const field of ['tenantId','artworkId'] as const){const h=setup();await h.revise();const b=h.approvals.get(1)!.snapshot.importedArtwork!.extensions!['org.exhibitos.studio/cms'] as unknown as Record<string,string|number>;b[field]=crypto.randomUUID();await expect(h.approve()).rejects.toMatchObject({code:'APPROVAL_INVALID'});expect(h.approvals.has(2)).toBe(false);}
 const declared=setup();await declared.revise();declared.asset.sha256='b'.repeat(64);await expect(declared.approve()).rejects.toMatchObject({code:'APPROVAL_INVALID'});
 const stored=setup();await stored.revise();stored.get.mockResolvedValueOnce(Buffer.from('changed source'));await expect(stored.approve()).rejects.toMatchObject({code:'ASSET_INTEGRITY'});expect(stored.approvals.has(2)).toBe(false);
});
test('ordinary non-imported approvals retain the existing revision projection behavior',async()=>{
 const h=setup(false);await h.revise({description:'Ordinary updated description',dimensions:{width:2,height:3,depth:.7,unit:'m'}});await h.approve();expect(h.approvals.get(2)!.snapshot.importedArtwork).toBeUndefined();const a=(await h.cms.studioArtwork(h.c,session,id)).artwork;expect(a.metadata.description).toBe('Ordinary updated description');expect(a.dimensions).toEqual({width:2,height:3,depth:.7});expect(a.extensions![DISPLAY_POLICY_NAMESPACE]).toBeUndefined();expect(a.revision).toBe(2);
});
