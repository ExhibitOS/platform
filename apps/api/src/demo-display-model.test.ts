// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi,afterEach} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex,type Artwork} from '@exhibitos/spec';
import {DISPLAY_POLICY_NAMESPACE as N,LOD_NAMESPACE} from '@exhibitos/studio-contract';
import type {Pool,PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {APPROVED_DEMO_DISPLAY_FILES as approved} from './approved-demo-display-files.ts';
import {qualifyDemoDisplay} from './demo-display-policy.ts';
import {publicationModelDerivative} from './demo-display-derivative.ts';
import {decode} from './imports.ts';
import {derivative} from './derivative.ts';
import {measureFullVariant,viewerVariants} from './viewer-variants.ts';
import {Publications,projectPublication} from './publication.ts';
import {checkOexProfile,remapOex} from './oex.ts';
const witness=vi.hoisted(()=>({bytes:Buffer.alloc(0),approvalId:'10000000-0000-4000-8000-000000000097'}));
// Synthetic approval and mocked isolated decoder only. These tests do not admit
// the real model or claim strict decoding, compact runtime or public acceptance.
vi.mock('./approved-demo-display-files.ts',async original=>{
 const real=await original<typeof import('./approved-demo-display-files.ts')>(),{readFile}=await import('node:fs/promises'),{fixtureURL,readOex}=await import('@exhibitos/spec'),{createHash}=await import('node:crypto');
 const {exhibition,files,manifest}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),a=exhibition.artworks.find(a=>a.artworkType==='sculpture')!,entry=manifest.assets.find(e=>e.id===a.primaryAssetId)!;
 witness.bytes=Buffer.from(files.get(entry.path)!);
 const size=witness.bytes.readUInt32LE(12),doc=JSON.parse(witness.bytes.toString('utf8',20,20+size));let triangles=0;
 for(const node of doc.nodes)for(const primitive of doc.meshes[node.mesh]?.primitives??[])triangles+=doc.accessors[primitive.indices??primitive.attributes.POSITION].count/3;
 return {...real,APPROVED_DEMO_DISPLAY_FILES:[...real.APPROVED_DEMO_DISPLAY_FILES,{...real.APPROVED_DEMO_DISPLAY_FILES[0],approvalId:witness.approvalId,canonicalAssetSha256:createHash('sha256').update(witness.bytes).digest('hex'),canonicalBytes:witness.bytes.length,canonicalMime:'model/gltf-binary',canonicalRole:'model',artworkType:'sculpture',canonicalTriangles:triangles,canonicalMaxTextureSize:512}]};
});
vi.mock('./imports.ts',async original=>({...await original<typeof import('./imports.ts')>(),decode:vi.fn(async()=>{})}));
vi.mock('./derivative.ts',()=>({derivative:vi.fn(async()=>Buffer.from('marked default'))}));
vi.mock('./viewer-variants.ts',async original=>({...await original<typeof import('./viewer-variants.ts')>(),viewerVariants:vi.fn(async()=>{throw Error('COARSE_UNAVAILABLE');})}));
afterEach(()=>vi.clearAllMocks());
async function fixture(){
 const {exhibition}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),a=exhibition.artworks.find(a=>a.artworkType==='sculpture')!,entry=approved.find(a=>a.approvalId===witness.approvalId)!;
 a.assets=[{...a.assets.find(v=>v.id===a.primaryAssetId)!,sha256:entry.canonicalAssetSha256,bytes:entry.canonicalBytes}];
 a.extensions={[N]:{version:1,profile:'approved-open-access-demo-v1',approvalId:entry.approvalId,sourceAssetSha256:entry.canonicalAssetSha256,rightsEvidenceSha256:entry.rightsEvidenceSha256}};
 exhibition.artworks=[a];exhibition.mediaAssets=[];exhibition.audioZones=[];exhibition.scripts=[];exhibition.placements=exhibition.placements.filter(p=>p.artworkRevisionId===a.revisionId);exhibition.annotations=exhibition.annotations.filter(v=>exhibition.placements.some(p=>p.id===v.placementId));exhibition.accessibility.artworkDescriptions=exhibition.accessibility.artworkDescriptions.filter(d=>exhibition.placements.some(p=>p.id===d.placementId));
 return {a,exhibition};
}
test('only a model-typed exact approval qualifies; wrong identity, type, rights and authored pairs fail closed',async()=>{
 const {a}=await fixture();expect(qualifyDemoDisplay(a,witness.bytes)?.canonicalMime).toBe('model/gltf-binary');
 for(const change of [(a:Artwork)=>{a.artworkType='image';},(a:Artwork)=>{a.assets[0]!.role='image';},(a:Artwork)=>{a.assets[0]!.mime='image/png';},(a:Artwork)=>{a.assets[0]!.bytes++;},(a:Artwork)=>{a.rights.permissions.display=false;},(a:Artwork)=>{a.extensions![N]={...a.extensions![N] as object,approvalId:approved[0].approvalId};},(a:Artwork)=>{a.extensions![N]={...a.extensions![N] as object,rightsEvidenceSha256:'a'.repeat(64)};},(a:Artwork)=>{a.extensions![LOD_NAMESPACE]={version:1,variants:[{assetId:a.primaryAssetId,detail:'full',triangles:1}]};}]){
  const changed=structuredClone(a);change(changed);expect(()=>qualifyDemoDisplay(changed,witness.bytes)).toThrow('DISPLAY_POLICY_INVALID');
 }
 const extra=structuredClone(a);extra.assets.push({...extra.assets[0]!,id:crypto.randomUUID()});expect(()=>qualifyDemoDisplay(extra)).toThrow('DISPLAY_POLICY_INVALID');
 expect(()=>qualifyDemoDisplay(a,Buffer.alloc(witness.bytes.length))).toThrow('ASSET_INTEGRITY');
});
test('the real selected model record binds the new rights snapshot rather than the supporting review file digest',async()=>{
 const {a}=await fixture(),entry=approved.find(a=>a.approvalId==='2963550d-61e7-55ab-9be9-19813e8e5ea4')!;
 a.assets[0]!.sha256=entry.canonicalAssetSha256;a.assets[0]!.bytes=entry.canonicalBytes;
 a.extensions![N]={version:1,profile:'approved-open-access-demo-v1',approvalId:entry.approvalId,sourceAssetSha256:entry.canonicalAssetSha256,rightsEvidenceSha256:entry.rightsEvidenceSha256};
 expect(qualifyDemoDisplay(a)?.canonicalTriangles).toBe(20000);expect(qualifyDemoDisplay(a)?.canonicalMaxTextureSize).toBe(512);
 a.extensions![N]={...a.extensions![N] as object,rightsEvidenceSha256:'448a4193a1668e67588c36224b25dd63b9c595f4039b8ee45a23253351f9d94c'};
 expect(()=>qualifyDemoDisplay(a)).toThrow('DISPLAY_POLICY_INVALID');
});
test('selected bytes must pass the existing strict decoder and are copied exactly; default GLB keeps its mark',async()=>{
 const {a}=await fixture(),before=Buffer.from(witness.bytes),copy=await publicationModelDerivative(a,witness.bytes);
 expect(decode).toHaveBeenCalledWith(witness.bytes,'model/gltf-binary');expect(copy).toEqual(before);expect(copy).not.toBe(witness.bytes);expect(witness.bytes).toEqual(before);expect(derivative).not.toHaveBeenCalled();
 vi.mocked(decode).mockRejectedValueOnce(Error('FORMAT_REJECTED'));await expect(publicationModelDerivative(a,witness.bytes)).rejects.toThrow('FORMAT_REJECTED');
 delete a.extensions;expect(await publicationModelDerivative(a,witness.bytes)).toEqual(Buffer.from('marked default'));expect(derivative).toHaveBeenCalledWith(witness.bytes,'model/gltf-binary');
});
test('a manifest metric declaration cannot replace actual full-variant measurement',async()=>{
 const {a}=await fixture(),entry=approved.find(a=>a.approvalId===witness.approvalId)! as unknown as {canonicalTriangles:number},before=entry.canonicalTriangles;
 try{entry.canonicalTriangles=before+1;await expect(publicationModelDerivative(a,witness.bytes)).rejects.toThrow('DISPLAY_POLICY_INVALID');}finally{entry.canonicalTriangles=before;}
});
test('typed OEX/public projection retains exact model policy, credit, authored scale and geometry bytes without private scope',async()=>{
 const {a,exhibition}=await fixture(),before=structuredClone(a);
 expect(()=>checkOexProfile(exhibition)).not.toThrow();const remapped=remapOex(exhibition).exhibition;expect(remapped.artworks[0]!.extensions![N]).toEqual(a.extensions![N]);expect(()=>checkOexProfile(remapped)).not.toThrow();
 a.extensions!['org.exhibitos.studio/cms']={tenantId:crypto.randomUUID(),artworkId:a.id,revision:a.revision};
 const projected=projectPublication(exhibition,[{artwork:a,sourceAssetId:a.primaryAssetId,sourceSha256:a.assets[0]!.sha256,bytes:witness.bytes,mime:'model/gltf-binary',variants:{full:measureFullVariant(witness.bytes,'model/gltf-binary')}}],'2026-10-25T00:00:00Z'),out=projected.snapshot.artworks[0]!;
 expect(out.extensions![N]).toEqual(before.extensions![N]);expect(out.extensions!['org.exhibitos.studio/cms']).toBeUndefined();expect(out.rights).toEqual(before.rights);expect(out.dimensions).toEqual(before.dimensions);expect(out.transform).toEqual(before.transform);expect(projected.assets[0]!.prepared.bytes).toBe(witness.bytes);expect(()=>checkOexProfile(projected.snapshot)).not.toThrow();
});
async function producer(){
 const {a,exhibition}=await fixture(),s={tenantId:crypto.randomUUID(),userId:crypto.randomUUID(),role:'admin'} as Session;
 a.extensions!['org.exhibitos.studio/cms']={tenantId:s.tenantId,artworkId:a.id,revision:a.revision};
 const p=new Publications({} as Pool),c={} as PoolClient;
 const current=vi.spyOn(p.cms,'studioArtwork').mockImplementation(async()=>({artwork:structuredClone(a),previewUrl:''}));
 const original=vi.spyOn(p.cms,'approvedVariantOriginal').mockResolvedValue(witness.bytes),display=vi.spyOn(p.cms,'display');
 const run=()=>Reflect.get(p,'prepare').call(p,c,s,exhibition,exhibition.id) as Promise<{issues:{code:string}[];prepared:{bytes:Buffer;variants:{full:{triangles:number};coarse?:unknown}}[]}>;
 return {a,p,c,s,exhibition,current,original,display,run};
}
test('publication uses current approved primary bytes twice, skips simplification and keeps a truthful full-only result',async()=>{
 const h=await producer(),result=await h.run();expect(result.issues).toEqual([]);expect(result.prepared).toHaveLength(1);expect(result.prepared[0]!.bytes).toEqual(witness.bytes);expect(result.prepared[0]!.variants).toEqual({full:measureFullVariant(witness.bytes,'model/gltf-binary')});expect(h.original).toHaveBeenCalledTimes(2);expect(h.original).toHaveBeenCalledWith(h.c,h.s,h.a.id,h.a.primaryAssetId,h.a.revision);expect(h.display).not.toHaveBeenCalled();expect(viewerVariants).not.toHaveBeenCalled();
});
test('publication refuses missing current scope, revoked approval, changed snapshot and post-decode bytes instead of falling back',async()=>{
 const scope=await producer();scope.a.extensions!['org.exhibitos.studio/cms']={tenantId:crypto.randomUUID(),artworkId:scope.a.id,revision:scope.a.revision};expect((await scope.run()).issues[0]!.code).toBe('ARTWORK_NOT_APPROVED');expect(scope.original).not.toHaveBeenCalled();
 const revoked=await producer();revoked.original.mockRejectedValueOnce(Object.assign(Error('RIGHTS_DENIED'),{code:'RIGHTS_DENIED'}));expect((await revoked.run()).issues).not.toEqual([]);expect(revoked.display).not.toHaveBeenCalled();
 const changed=await producer();changed.current.mockResolvedValueOnce({artwork:structuredClone(changed.a),previewUrl:''}).mockImplementation(async()=>({artwork:{...changed.a,revision:changed.a.revision+1},previewUrl:''}));expect((await changed.run()).issues[0]!.code).toBe('REVISION_CONFLICT');expect(changed.display).not.toHaveBeenCalled();
 const bytes=await producer();bytes.original.mockResolvedValueOnce(witness.bytes).mockResolvedValueOnce(Buffer.alloc(1));expect((await bytes.run()).issues[0]!.code).toBe('ASSET_INTEGRITY');expect(bytes.display).not.toHaveBeenCalled();
});
