// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {createHash,randomUUID} from 'node:crypto';
import {artworkReplacementSnapshot} from './artwork-replacement-snapshot.ts';
const witness=vi.hoisted(()=>({full:Buffer.alloc(100,1),coarse:Buffer.alloc(50,2),approvalId:'10000000-0000-4000-8000-000000000099',original:'a'.repeat(64)}));
vi.mock('./approved-demo-display-files.ts',async original=>{
 const real=await original<typeof import('./approved-demo-display-files.ts')>(),{createHash}=await import('node:crypto'),hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 return {...real,APPROVED_DEMO_DISPLAY_FILES:[...real.APPROVED_DEMO_DISPLAY_FILES,{...real.APPROVED_DEMO_DISPLAY_FILES[0],approvalId:witness.approvalId,rawSourceSha256:witness.original,canonicalAssetSha256:hash(witness.full),canonicalBytes:witness.full.length,coarse:{sha256:hash(witness.coarse),bytes:witness.coarse.length,width:512,height:408}}]};
});
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
it('constructs a new exact asset pair while preserving original artwork metadata and rejects altered coarse bytes',async()=>{
 const {exhibition}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),prior=exhibition.artworks.find(a=>a.artworkType==='image')!,saved=structuredClone(prior),input={tenantId:randomUUID(),revisionId:randomUUID(),at:new Date().toISOString(),primaryId:randomUUID(),coarseId:randomUUID(),intent:{version:1 as const,profile:'viewer-png-box-512-v1' as const,approvalId:witness.approvalId,artworkRevision:prior.revision},originalSha256:witness.original,primary:witness.full,coarse:witness.coarse};
 const result=artworkReplacementSnapshot(prior,input);
 expect(prior).toEqual(saved);expect(result.metadata).toEqual(prior.metadata);expect(result.dimensions).toEqual(prior.dimensions);expect(result.rights).toEqual(prior.rights);expect(result.revision).toBe(prior.revision+1);expect(result.assets.map(a=>a.sha256)).toEqual([hash(witness.full),hash(witness.coarse)]);
 expect(()=>artworkReplacementSnapshot(prior,{...input,coarse:Buffer.alloc(50,3)})).toThrow('ASSET_INTEGRITY');expect(()=>artworkReplacementSnapshot(prior,{...input,originalSha256:'b'.repeat(64)})).toThrow('COARSE_POLICY_UNQUALIFIED');
});
