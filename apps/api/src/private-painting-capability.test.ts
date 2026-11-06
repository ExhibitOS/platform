// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {DISPLAY_POLICY_NAMESPACE as N} from '@exhibitos/studio-contract';
import {APPROVED_DEMO_DISPLAY_FILES as approved} from './approved-demo-display-files.ts';
import {issuePrivatePaintingCapability,privatePaintingCandidateRecipe,type DemoDisplayApproval} from './demo-display-policy.ts';
import {privatePaintingCacheIdentity} from './display-derivative-cache.ts';

const witness=vi.hoisted(()=>({bytes:Buffer.alloc(100,7)}));
// Test-only synthetic approval exercises the real policy; no production entry is added.
vi.mock('./approved-demo-display-files.ts',async original=>{
 const real=await original<typeof import('./approved-demo-display-files.ts')>(),{createHash}=await import('node:crypto');
 return {...real,APPROVED_DEMO_DISPLAY_FILES:[...real.APPROVED_DEMO_DISPLAY_FILES,...(['painting-1926x2634','painting-2419x2552','painting-2135x1362',undefined,'painting-1926x2634'] as const).map((profile,index)=>{const bytes=index===4?Buffer.alloc(8388609,7):witness.bytes;return {...real.APPROVED_DEMO_DISPLAY_FILES[0],approvalId:`10000000-0000-4000-8000-00000000009${index}`,canonicalAssetSha256:createHash('sha256').update(bytes).digest('hex'),canonicalBytes:bytes.length,...(profile?{privatePaintingCandidate:profile}:{})};})]};
});
const tenantId='10000000-0000-4000-8000-000000000010';
async function fixture(index=0){
 const {exhibition}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),artwork=exhibition.artworks.find(v=>v.artworkType==='image')!,entry=approved.find(v=>v.approvalId===`10000000-0000-4000-8000-00000000009${index}`)! as DemoDisplayApproval;
 const primary={...artwork.assets[0]!,bytes:entry.canonicalBytes,sha256:entry.canonicalAssetSha256};artwork.assets=[primary];artwork.primaryAssetId=primary.id;
 artwork.extensions={[N]:{version:1,profile:'approved-open-access-demo-v1',approvalId:entry.approvalId,sourceAssetSha256:entry.canonicalAssetSha256,rightsEvidenceSha256:entry.rightsEvidenceSha256},'org.exhibitos.studio/cms':{tenantId,artworkId:artwork.id,revision:artwork.revision}} as typeof artwork.extensions;
 return {artwork,currentArtwork:structuredClone(artwork),tenantId,assetId:primary.id,bytes:index===4?Buffer.alloc(8388609,7):Buffer.from(witness.bytes),purpose:'full' as const};
}
test('issues only exact synthetic approved full sources and separates fixed recipes',async()=>{
 const recipes=[],identities=[];for(let i=0;i<3;i++){const c=await fixture(i),cap=issuePrivatePaintingCapability(c);expect(Object.isFrozen(cap)).toBe(true);recipes.push(privatePaintingCandidateRecipe(cap,c));identities.push(privatePaintingCacheIdentity(cap,c).identity);}
 expect(recipes.map(v=>[v.width,v.height])).toEqual([[1926,2634],[2419,2552],[2135,1362]]);expect(new Set(recipes.map(v=>JSON.stringify(v))).size).toBe(3);expect(new Set(identities).size).toBe(3);
 const c=await fixture(),cap=issuePrivatePaintingCapability(c);expect(privatePaintingCacheIdentity(cap,c,{version:1,mode:'embedded',text:'Author'}).identity).not.toBe(privatePaintingCacheIdentity(cap,c).identity);
});
test('rejects stale revision, tenant, rights, bytes, non-primary and non-full purpose',async()=>{
 const c=await fixture(),cap=issuePrivatePaintingCapability(c);
 expect(()=>issuePrivatePaintingCapability({...c,tenantId:'other'})).toThrow();expect(()=>issuePrivatePaintingCapability({...c,purpose:'coarse'})).toThrow();expect(()=>issuePrivatePaintingCapability({...c,assetId:'other'})).toThrow();
 expect(()=>issuePrivatePaintingCapability({...c,currentArtwork:{...c.currentArtwork,revision:c.currentArtwork.revision+1}})).toThrow();
 const rights=structuredClone(c.artwork);rights.rights.permissions.display=false;expect(()=>issuePrivatePaintingCapability({...c,artwork:rights,currentArtwork:structuredClone(rights)})).toThrow();
 expect(()=>issuePrivatePaintingCapability({...c,bytes:Buffer.alloc(100,8)})).toThrow();expect(()=>issuePrivatePaintingCapability({...c,bytes:Buffer.alloc(99,7)})).toThrow();
 expect(()=>privatePaintingCandidateRecipe(cap,{...c,bytes:Buffer.alloc(100,8)})).toThrow();expect(()=>privatePaintingCandidateRecipe({...cap},c)).toThrow();
 expect(()=>privatePaintingCandidateRecipe(cap,{...c,currentArtwork:{...c.currentArtwork,revision:c.currentArtwork.revision+1}})).toThrow();
});
test('rejects an exact otherwise approved source over the encoded byte bound',async()=>{
 const c=await fixture(4);expect(()=>issuePrivatePaintingCapability(c)).toThrow('DISPLAY_POLICY_INVALID');
});
test('an existing approval with no candidate grant cannot activate the private lane',async()=>{
 const c=await fixture(3);expect(()=>issuePrivatePaintingCapability(c)).toThrow('DISPLAY_POLICY_INVALID');
});
