// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import type {BlobStore} from '@exhibitos/storage';
import {ENTRANCE_NAMESPACE,LOD_NAMESPACE} from '@exhibitos/studio-contract';
const policy=vi.hoisted(()=>({qualifyDemoDisplay:vi.fn()}));
vi.mock('./demo-display-policy.ts',()=>policy);
const worker=vi.hoisted(()=>({viewerVariants:vi.fn()}));
vi.mock('./viewer-variants.ts',()=>worker);
import {approvedCoverProjection} from './approved-cover-projection.ts';
const full='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',low='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function png(width:number,height:number,length:number){const b=Buffer.alloc(length);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);return b;}
function fixture(){const a=png(1024,800,100),b=png(512,400,50),ah=sha(a),bh=sha(b);
 const artwork={artworkType:'image',primaryAssetId:full,assets:[{id:full,mime:'image/png',role:'image',bytes:a.length,sha256:ah},{id:low,mime:'image/png',role:'image',bytes:b.length,sha256:bh}],extensions:{[LOD_NAMESPACE]:{version:1,variants:[{assetId:full,detail:'full',textureSize:1024},{assetId:low,detail:'coarse',textureSize:512}]}}};
 const snapshot={artworks:[artwork],extensions:{[ENTRANCE_NAMESPACE]:{version:1,artist:'',introduction:'',imageAlt:'Example',imageAssetId:full,mobilePosition:'center'}}} as unknown as Exhibition;
 const assets=[{id:full,source_sha256:ah,sha256:ah,bytes:a.length,mime:'image/png',object_key:'full'},{id:low,source_sha256:bh,sha256:bh,bytes:b.length,mime:'image/png',object_key:'low'}];
 policy.qualifyDemoDisplay.mockReturnValue({canonicalAssetSha256:ah,canonicalBytes:a.length,coarse:{sha256:bh,bytes:b.length,width:512,height:400}});
 const blobs={get:async(key:string)=>key==='full'?a:b} as unknown as BlobStore;return {snapshot,assets,blobs,a,b};}
it('emits only the exact approved source pair already admitted to publication',async()=>{const f=fixture(),result=await approvedCoverProjection(f.snapshot,'c'.repeat(64),f.assets,f.blobs);expect(result).toMatchObject({version:1,revisionSha256:'c'.repeat(64),primary:{assetId:full,width:1024,height:800},variants:[{assetId:low,width:512,height:400}]});});
it('omits unbound or absent pairs and detects changed bytes',async()=>{const f=fixture();f.assets[1]!.source_sha256='0'.repeat(64);expect(await approvedCoverProjection(f.snapshot,'c'.repeat(64),f.assets,f.blobs)).toBeUndefined();f.assets[1]!.source_sha256=sha(f.b);f.b[32]=1;await expect(approvedCoverProjection(f.snapshot,'c'.repeat(64),f.assets,f.blobs)).rejects.toThrow('COVER_ASSET_INTEGRITY');});
it('requires an exact server transform for non-curated pairs and caches only successful proof',async()=>{
 const f=fixture();policy.qualifyDemoDisplay.mockReturnValue(undefined);worker.viewerVariants.mockResolvedValue({bytes:Buffer.from(f.b)});
 expect(await approvedCoverProjection(f.snapshot,'c'.repeat(64),f.assets,f.blobs)).toBeDefined();
 expect(await approvedCoverProjection(f.snapshot,'c'.repeat(64),f.assets,f.blobs)).toBeDefined();expect(worker.viewerVariants).toHaveBeenCalledTimes(1);
 f.b[49]=1;const h=sha(f.b);f.assets[1]!.sha256=h;f.assets[1]!.source_sha256=h;
 expect(await approvedCoverProjection(f.snapshot,'c'.repeat(64),f.assets,f.blobs)).toBeUndefined();expect(worker.viewerVariants).toHaveBeenCalledTimes(2);
});
