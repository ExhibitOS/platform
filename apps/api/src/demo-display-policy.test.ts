// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {DISPLAY_POLICY_NAMESPACE as N} from '@exhibitos/studio-contract';
import {APPROVED_DEMO_DISPLAY_FILES as approved} from './approved-demo-display-files.ts';
import {qualifyDemoDisplay} from './demo-display-policy.ts';
import {publicationImageDerivative} from './demo-display-derivative.ts';
import {checkOexProfile,remapOex} from './oex.ts';
import {projectPublication} from './publication.ts';
import {validateDraft} from '../../web/src/drafts/validator.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
const policy=(a:Awaited<ReturnType<typeof fixture>>)=>a.extensions![N] as unknown as {approvalId:string;rightsEvidenceSha256:string};
async function fixture(index=0){const {exhibition}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),a=exhibition.artworks.find(a=>a.artworkType==='image')!,entry=approved[index]!;a.assets=[{...a.assets[0]!,sha256:entry.canonicalAssetSha256,bytes:entry.canonicalBytes}];a.extensions={[N]:{version:1,profile:'approved-open-access-demo-v1',approvalId:entry.approvalId,sourceAssetSha256:entry.canonicalAssetSha256,rightsEvidenceSha256:entry.rightsEvidenceSha256}};return a;}
test('selected metadata declaration matches only the immutable exact-file approval, without proving bytes',async()=>{const a=await fixture();expect(qualifyDemoDisplay(a)?.approvalId).toBe(approved[0].approvalId);expect(()=>qualifyDemoDisplay(a,Buffer.alloc(0))).toThrow('ASSET_INTEGRITY');});
test('unknown approval, evidence, primary hash and revoked display rights never get a neutral exception',async()=>{
 for(const change of [(a:Awaited<ReturnType<typeof fixture>>)=>{policy(a).approvalId=crypto.randomUUID();},(a:Awaited<ReturnType<typeof fixture>>)=>{policy(a).rightsEvidenceSha256='a'.repeat(64);},(a:Awaited<ReturnType<typeof fixture>>)=>{a.assets[0]!.sha256='b'.repeat(64);},(a:Awaited<ReturnType<typeof fixture>>)=>{a.rights.permissions.display=false;}]){const a=await fixture();change(a);expect(()=>qualifyDemoDisplay(a)).toThrow('DISPLAY_POLICY_INVALID');}
});
test('legacy CC0 without namespace still gets the existing marked derivative',async()=>{const {exhibition,files,manifest}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),a=exhibition.artworks.find(a=>a.artworkType==='image')!,entry=manifest.assets.find(e=>e.id===a.primaryAssetId)!,bytes=Buffer.from(files.get(entry.path)!);delete a.extensions;const marked=await publicationImageDerivative(a,bytes);expect(marked.equals(bytes)).toBe(false);});
test.skipIf(!process.env.EXHIBITOS_APPROVED_DEMO_CANONICAL)('owned exact selected canonical bytes pass strict neutral production without reencoding',async()=>{
 const timing:Record<string,number>={},start=performance.now();
 const a=await fixture();timing.fixtureMs=performance.now()-start;
 const bytes=await readFile(process.env.EXHIBITOS_APPROVED_DEMO_CANONICAL!),before=Buffer.from(bytes);timing.readMs=performance.now()-start;
 const neutral=await publicationImageDerivative(a,bytes);timing.decodeMs=performance.now()-start;
 expect(neutral.equals(bytes)).toBe(true);expect(bytes.equals(before)).toBe(true);expect(neutral===bytes).toBe(false);
 timing.assertionsMs=performance.now()-start;console.info('OWNED_PNG_STAGE_TIMING',JSON.stringify(timing));
});

test.skipIf(!process.env.EXHIBITOS_APPROVED_DEMO_CANONICAL)('owned observed primary policy survives typed OEX/public projection without private bindings',async()=>{
 const {exhibition:d}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),a=await fixture(),bytes=await readFile(process.env.EXHIBITOS_APPROVED_DEMO_CANONICAL!);
 d.artworks=[a];d.mediaAssets=[];d.audioZones=[];d.placements=d.placements.filter(p=>p.artworkRevisionId===a.revisionId);d.accessibility.artworkDescriptions=d.accessibility.artworkDescriptions.filter(v=>d.placements.some(p=>p.id===v.placementId));
 expect(()=>checkOexProfile(d)).not.toThrow();const remapped=remapOex(d).exhibition;expect(remapped.artworks[0]!.extensions![N]).toEqual(a.extensions![N]);expect(()=>checkOexProfile(remapped)).not.toThrow();
 a.extensions={...a.extensions,'org.exhibitos.studio/cms':{tenantId:crypto.randomUUID(),artworkId:a.id,revision:a.revision}};
 const projected=projectPublication(d,[{artwork:a,sourceAssetId:a.primaryAssetId,sourceSha256:a.assets[0]!.sha256,bytes,mime:'image/png'}],'2026-10-23T00:00:00.000Z').snapshot;
 expect(projected.artworks[0]!.extensions![N]).toEqual(a.extensions[N]);expect(projected.artworks[0]!.extensions!['org.exhibitos.studio/cms']).toBeUndefined();expect(projected.artworks[0]!.provenance.events[0]!.description).toContain(approved[0].recipeSha256);expect(()=>checkOexProfile(projected)).not.toThrow();
 const draft=newDraft();draft.candidate=projected;draft.exhibitionId=projected.id;expect(validateDraft(draft).valid).toBe(true);
});

test.skipIf(!process.env.EXHIBITOS_APPROVED_DEMO_ROOT).each([1,2])('successor selected canonical %i binds actual primary bytes and retains exact producer output',async index=>{
 const a=await fixture(index),entry=approved[index]!,path=join(process.env.EXHIBITOS_APPROVED_DEMO_ROOT!,'derived',entry.institutionRecordId.replace('met-','met')+'-canonical-prototype-v1','canonical.png'),bytes=await readFile(path),before=Buffer.from(bytes);
 expect(qualifyDemoDisplay(a,bytes)?.approvalId).toBe(entry.approvalId);
 const neutral=await publicationImageDerivative(a,bytes);expect(neutral.equals(bytes)).toBe(true);expect(bytes.equals(before)).toBe(true);expect(neutral===bytes).toBe(false);
 policy(a).approvalId=approved[0].approvalId;expect(()=>qualifyDemoDisplay(a,bytes)).toThrow('DISPLAY_POLICY_INVALID');
});
