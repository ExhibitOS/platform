// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {DISPLAY_POLICY_NAMESPACE as N} from '@exhibitos/studio-contract';
import {APPROVED_DEMO_DISPLAY_FILES as approved} from './approved-demo-display-files.ts';
import {issuePrivatePaintingCapability,privatePaintingCandidateRecipe,qualifyDemoDisplay,type DemoDisplayApproval} from './demo-display-policy.ts';
import {privatePaintingCacheIdentity} from './display-derivative-cache.ts';

const witness=vi.hoisted(()=>({images:[] as Buffer[],model:Buffer.alloc(0)}));
// Only synthetic approvals are injected into the real policy; no production grant changes.
vi.mock('./approved-demo-display-files.ts',async original=>{
 const real=await original<typeof import('./approved-demo-display-files.ts')>(),{createHash}=await import('node:crypto'),{deflateSync}=await import('node:zlib'),{pngCrc}=await import('./png-pixels.ts');
 const chunk=(name:string,body:Buffer)=>{const n=Buffer.alloc(4),c=Buffer.alloc(4),t=Buffer.from(name);n.writeUInt32BE(body.length);c.writeUInt32BE(pngCrc(Buffer.concat([t,body])));return Buffer.concat([n,t,body,c]);};
 const sizes=[[1925,2634],[2419,2552],[2135,1361]] as const;
 witness.images=sizes.map(([w,h])=>{const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('sRGB',Buffer.from([0])),chunk('IDAT',deflateSync(Buffer.alloc((w*3+1)*h))),chunk('IEND',Buffer.alloc(0))]);});
 const synthetic=(['painting-1925x2634','painting-2419x2552','painting-2135x1361',undefined,'painting-1925x2634'] as const).map((profile,index)=>{const image=witness.images[index<3?index:0]!,bytes=index===4?Buffer.concat([image,Buffer.alloc(8388609-image.length)]):image;const [sourceWidth,sourceHeight]=sizes[index<3?index:0]!;return {...real.APPROVED_DEMO_DISPLAY_FILES[0],approvalId:`10000000-0000-4000-8000-00000000009${index}`,canonicalAssetSha256:createHash('sha256').update(bytes).digest('hex'),canonicalBytes:bytes.length,...(profile?{privatePaintingCandidate:{profile,sourceWidth,sourceHeight,recipeID:'native-private-demo-painting-rgb8',recipeVersion:1,recipeSha256:'a'.repeat(64),colour:index===0?{kind:'no-profile-srgb-assumed'}:{kind:'icc-to-srgb',version:1,algorithm:'icc-to-srgb-jpeg-rgb8-v1',sourceIccSha256:'b'.repeat(64)}}}:{})};});
 const {readFile}=await import('node:fs/promises'),{fixtureURL,readOex}=await import('@exhibitos/spec'),{exhibition,files,manifest}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),model=exhibition.artworks.find(a=>a.artworkType==='sculpture')!,entry=manifest.assets.find(v=>v.artifactPath===model.assets.find(a=>a.id===model.primaryAssetId)!.path)!;
 witness.model=Buffer.from(files.get(entry.path)!);const doc=JSON.parse(witness.model.toString('utf8',20,20+witness.model.readUInt32LE(12)));let triangles=0;for(const node of doc.nodes)for(const primitive of doc.meshes[node.mesh]?.primitives??[])triangles+=doc.accessors[primitive.indices??primitive.attributes.POSITION].count/3;
 const modelApproval={...real.APPROVED_DEMO_DISPLAY_FILES[0],approvalId:'10000000-0000-4000-8000-000000000095',canonicalAssetSha256:createHash('sha256').update(witness.model).digest('hex'),canonicalBytes:witness.model.length,canonicalMime:'model/gltf-binary',canonicalRole:'model',artworkType:'sculpture',canonicalTriangles:triangles,canonicalMaxTextureSize:512,privatePaintingCandidate:{profile:'painting-1925x2634',sourceWidth:1925,sourceHeight:2634,recipeID:'native-private-demo-painting-rgb8',recipeVersion:1,recipeSha256:'a'.repeat(64),colour:{kind:'no-profile-srgb-assumed'}}};
 return {...real,APPROVED_DEMO_DISPLAY_FILES:[...real.APPROVED_DEMO_DISPLAY_FILES,...synthetic,modelApproval]};
});
const tenantId='10000000-0000-4000-8000-000000000010';
async function fixture(index=0,model=false){
 const {exhibition}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),artwork=exhibition.artworks.find(v=>v.artworkType===(model?'sculpture':'image'))!,entry=approved.find(v=>v.approvalId===`10000000-0000-4000-8000-00000000009${model?5:index}`)! as DemoDisplayApproval;
 const primary={...artwork.assets.find(v=>v.id===artwork.primaryAssetId)!,bytes:entry.canonicalBytes,sha256:entry.canonicalAssetSha256};artwork.assets=[primary];artwork.primaryAssetId=primary.id;
 artwork.extensions={[N]:{version:1,profile:'approved-open-access-demo-v1',approvalId:entry.approvalId,sourceAssetSha256:entry.canonicalAssetSha256,rightsEvidenceSha256:entry.rightsEvidenceSha256},'org.exhibitos.studio/cms':{tenantId,artworkId:artwork.id,revision:artwork.revision}} as typeof artwork.extensions;
 const image=witness.images[index<3?index:0]!;return {artwork,currentArtwork:structuredClone(artwork),tenantId,assetId:primary.id,bytes:model?Buffer.from(witness.model):index===4?Buffer.concat([image,Buffer.alloc(8388609-image.length)]):Buffer.from(image),purpose:'full' as const};
}
test('issues only exact synthetic approved full PNG sources and separates fixed recipes',async()=>{
 const recipes=[],identities=[];for(let i=0;i<3;i++){const c=await fixture(i),cap=issuePrivatePaintingCapability(c);expect(Object.isFrozen(cap)).toBe(true);expect(cap.recipeID).toBe('native-private-demo-painting-rgb8');expect(cap.recipeVersion).toBe(1);expect(cap.recipeSha256).toBe('a'.repeat(64));expect(cap.colour).toEqual(i===0?{kind:'no-profile-srgb-assumed'}:{kind:'icc-to-srgb',version:1,algorithm:'icc-to-srgb-jpeg-rgb8-v1',sourceIccSha256:'b'.repeat(64)});expect(Object.isFrozen(cap.colour)).toBe(true);expect(()=>Object.assign(cap.colour,{kind:'other'})).toThrow();recipes.push(privatePaintingCandidateRecipe(cap,c));identities.push(privatePaintingCacheIdentity(cap,c).identity);}
 expect(recipes.map(v=>[v.width,v.height])).toEqual([[1925,2634],[2419,2552],[2135,1361]]);expect(new Set(identities).size).toBe(3);
 const c=await fixture(),cap=issuePrivatePaintingCapability(c),marked=privatePaintingCacheIdentity(cap,c,{version:1,mode:'embedded',text:'Author'});expect(marked.identity).not.toBe(privatePaintingCacheIdentity(cap,c).identity);expect(Object.isFrozen(marked.recipe)).toBe(true);expect(Object.isFrozen(marked.recipe.watermark)).toBe(true);expect(()=>Object.assign(marked.recipe,{width:1})).toThrow();expect(()=>Object.assign(marked.recipe.watermark,{text:'OTHER'})).toThrow();
});
test('rejects stale revision, tenant, rights, bytes, non-primary and non-full purpose',async()=>{
 const c=await fixture(),cap=issuePrivatePaintingCapability(c);
 expect(()=>issuePrivatePaintingCapability({...c,tenantId:'other'})).toThrow();expect(()=>issuePrivatePaintingCapability({...c,purpose:'coarse'})).toThrow();expect(()=>issuePrivatePaintingCapability({...c,assetId:'other'})).toThrow();
 expect(()=>issuePrivatePaintingCapability({...c,currentArtwork:{...c.currentArtwork,revision:c.currentArtwork.revision+1}})).toThrow();
 const rights=structuredClone(c.artwork);rights.rights.permissions.display=false;expect(()=>issuePrivatePaintingCapability({...c,artwork:rights,currentArtwork:structuredClone(rights)})).toThrow();
 const corrupt=Buffer.from(c.bytes);corrupt[40]=(corrupt[40]??0)^1;expect(()=>issuePrivatePaintingCapability({...c,bytes:corrupt})).toThrow();expect(()=>issuePrivatePaintingCapability({...c,bytes:c.bytes.subarray(0,-1)})).toThrow();
 expect(()=>privatePaintingCandidateRecipe(cap,{...c,bytes:corrupt})).toThrow();expect(()=>privatePaintingCandidateRecipe({...cap},c)).toThrow();expect(()=>privatePaintingCandidateRecipe(cap,{...c,currentArtwork:{...c.currentArtwork,revision:c.currentArtwork.revision+1}})).toThrow();
});
test('rejects mismatched approved dimensions and changed recipe binding',async()=>{
 const c=await fixture(),entry=approved.find(v=>String(v.approvalId)==='10000000-0000-4000-8000-000000000090')! as DemoDisplayApproval,candidate=entry.privatePaintingCandidate!,cap=issuePrivatePaintingCapability(c);
 try{entry.privatePaintingCandidate={...candidate,recipeID:'other' as never};expect(()=>issuePrivatePaintingCapability(c)).toThrow('DISPLAY_POLICY_INVALID');entry.privatePaintingCandidate={...candidate,recipeVersion:2 as never};expect(()=>issuePrivatePaintingCapability(c)).toThrow('DISPLAY_POLICY_INVALID');entry.privatePaintingCandidate={...candidate,sourceWidth:candidate.sourceWidth+1};expect(()=>issuePrivatePaintingCapability(c)).toThrow('DISPLAY_POLICY_INVALID');entry.privatePaintingCandidate={...candidate,recipeSha256:'c'.repeat(64)};expect(()=>privatePaintingCandidateRecipe(cap,c)).toThrow('DISPLAY_POLICY_INVALID');entry.privatePaintingCandidate={...candidate,colour:{kind:'icc-to-srgb',version:1,algorithm:'icc-to-srgb-jpeg-rgb8-v1',sourceIccSha256:'d'.repeat(64)}};expect(()=>privatePaintingCandidateRecipe(cap,c)).toThrow('DISPLAY_POLICY_INVALID');}finally{entry.privatePaintingCandidate=candidate;}
});
test('an exact otherwise approved source over 8 MiB or without grant is refused',async()=>{
 const large=await fixture(4),ordinary=await fixture(3);expect(()=>issuePrivatePaintingCapability(large)).toThrow('DISPLAY_POLICY_INVALID');expect(()=>issuePrivatePaintingCapability(ordinary)).toThrow('DISPLAY_POLICY_INVALID');
});
test('a valid exact model approval cannot issue a painting capability',async()=>{
 const c=await fixture(0,true);expect(qualifyDemoDisplay(c.artwork,c.bytes)?.canonicalMime).toBe('model/gltf-binary');expect(()=>issuePrivatePaintingCapability(c)).toThrow('DISPLAY_POLICY_INVALID');
});

test('requires an exact explicit colour claim and binds it to the cache identity',async()=>{
 const c=await fixture(),entry=approved.find(v=>String(v.approvalId)==='10000000-0000-4000-8000-000000000090')! as DemoDisplayApproval,candidate=entry.privatePaintingCandidate!,cap=issuePrivatePaintingCapability(c),original=privatePaintingCacheIdentity(cap,c);
 const icc={kind:'icc-to-srgb',version:1,algorithm:'icc-to-srgb-jpeg-rgb8-v1',sourceIccSha256:'b'.repeat(64)} as const;
 const inherited=Object.assign(Object.create({kind:'no-profile-srgb-assumed'}),{unexpected:true});
 const invalid:unknown[]=[undefined,{},inherited, {kind:'unknown'}, {kind:'no-profile-srgb-assumed',sourceIccSha256:'0'.repeat(64)}, {...icc,sourceIccSha256:undefined}, {...icc,sourceIccSha256:'bad'}, {...icc,version:2}, {...icc,algorithm:'other'}, {...icc,extra:true}];
 try{
  for(const colour of invalid){entry.privatePaintingCandidate={...candidate,colour:colour as never};expect(()=>issuePrivatePaintingCapability(c)).toThrow('DISPLAY_POLICY_INVALID');}
  entry.privatePaintingCandidate={...candidate,colour:icc};expect(()=>privatePaintingCandidateRecipe(cap,c)).toThrow('DISPLAY_POLICY_INVALID');
  const changed=issuePrivatePaintingCapability(c),identity=privatePaintingCacheIdentity(changed,c);expect(identity.identity).not.toBe(original.identity);expect(identity.recipe.colour).toEqual(icc);expect(Object.isFrozen(identity.recipe.colour)).toBe(true);expect(()=>Object.assign(identity.recipe.colour,{sourceIccSha256:'c'.repeat(64)})).toThrow();
  entry.privatePaintingCandidate={...candidate,colour:{...icc,sourceIccSha256:'d'.repeat(64)}};expect(()=>privatePaintingCandidateRecipe(changed,c)).toThrow('DISPLAY_POLICY_INVALID');
 }finally{entry.privatePaintingCandidate=candidate;}
});

test('strict validation requires an issued exact capability and rejects corrupted full PNGs',async()=>{
 const {validatePrivatePainting}=await import('./private-painting-validation.ts'),{createHash}=await import('node:crypto');
 const c=await fixture(),cap=issuePrivatePaintingCapability(c);await expect(validatePrivatePainting(cap,c)).resolves.toBeUndefined();
 await expect(validatePrivatePainting({...cap},c)).rejects.toThrow('DISPLAY_POLICY_INVALID');
 const controller=new AbortController();controller.abort();await expect(validatePrivatePainting(cap,c,controller.signal)).rejects.toThrow('VALIDATION_CANCELLED');
 const entry=approved.find(v=>String(v.approvalId)==='10000000-0000-4000-8000-000000000090')! as DemoDisplayApproval,oldHash=entry.canonicalAssetSha256;
 const bad=Buffer.from(c.bytes);bad[bad.length-1]=(bad[bad.length-1]??0)^1;const hash=createHash('sha256').update(bad).digest('hex');
 try{
  (entry as {canonicalAssetSha256:string}).canonicalAssetSha256=hash;
  const artwork=structuredClone(c.artwork),primary=artwork.assets.find(a=>a.id===artwork.primaryAssetId)!;primary.sha256=hash;
  (artwork.extensions![N] as {sourceAssetSha256:string}).sourceAssetSha256=hash;
  const invalid={...c,artwork,currentArtwork:structuredClone(artwork),bytes:bad},badCap=issuePrivatePaintingCapability(invalid);
  await expect(validatePrivatePainting(badCap,invalid)).rejects.toThrow('FORMAT_REJECTED');
 }finally{(entry as {canonicalAssetSha256:string}).canonicalAssetSha256=oldHash;}
});

test('strict validation refuses approved RGB PNGs with absent or different sRGB intent',async()=>{
 const {validatePrivatePainting}=await import('./private-painting-validation.ts'),{createHash}=await import('node:crypto'),{pngCrc}=await import('./png-pixels.ts');
 const c=await fixture(),entry=approved.find(v=>String(v.approvalId)==='10000000-0000-4000-8000-000000000090')! as DemoDisplayApproval,oldHash=entry.canonicalAssetSha256,oldBytes=entry.canonicalBytes;
 const absent=Buffer.concat([c.bytes.subarray(0,33),c.bytes.subarray(46)]),different=Buffer.from(c.bytes);different[41]=1;different.writeUInt32BE(pngCrc(different.subarray(37,42)),42);
 try{for(const bytes of [absent,different]){
  const hash=createHash('sha256').update(bytes).digest('hex');(entry as {canonicalAssetSha256:string;canonicalBytes:number}).canonicalAssetSha256=hash;(entry as {canonicalBytes:number}).canonicalBytes=bytes.length;
  const artwork=structuredClone(c.artwork),primary=artwork.assets.find(a=>a.id===artwork.primaryAssetId)!;primary.sha256=hash;primary.bytes=bytes.length;
  (artwork.extensions![N] as {sourceAssetSha256:string}).sourceAssetSha256=hash;
  const invalid={...c,artwork,currentArtwork:structuredClone(artwork),bytes},cap=issuePrivatePaintingCapability(invalid);
  await expect(validatePrivatePainting(cap,invalid)).rejects.toThrow('FORMAT_REJECTED');
 }}finally{(entry as {canonicalAssetSha256:string;canonicalBytes:number}).canonicalAssetSha256=oldHash;(entry as {canonicalBytes:number}).canonicalBytes=oldBytes;}
});
