// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {Artwork} from '@exhibitos/spec';
import {LOD_NAMESPACE,BUDGET_GEOMETRY_PAIR_PROFILE,NEAR_GEOMETRY_PAIR_PROFILE,NEAR_TEXTURE_PAIR_PROFILE} from '@exhibitos/studio-contract';
import {Cms} from './cms.ts';
import {ApiError,type Session} from './auth.ts';
import * as qualifiers from './approved-lod-pair.ts';
const id='10000000-0000-4000-8000-000000000001',fullId='10000000-0000-4000-8000-000000000002',coarseId='10000000-0000-4000-8000-00000000000a';
const session={tenantId:id,userId:id,role:'artist'} as Session,c={} as PoolClient;
afterEach(()=>vi.restoreAllMocks());
function setup(profile:string=BUDGET_GEOMETRY_PAIR_PROFILE){
 const full=Buffer.from('synthetic approved full source'),coarse=Buffer.from('coarse'),display=Buffer.from('selected display copy');
 const artwork={id,revision:7,artworkType:'sculpture',primaryAssetId:fullId,assets:[{id:fullId,role:'model',mime:'model/gltf-binary',bytes:full.length,sha256:'a'.repeat(64)},{id:coarseId,role:'model',mime:'model/gltf-binary',bytes:coarse.length,sha256:'b'.repeat(64)}],extensions:{[LOD_NAMESPACE]:{version:1,profile,variants:[{assetId:fullId,detail:'full',triangles:100,textureSize:1024},{assetId:coarseId,detail:'coarse',triangles:profile===NEAR_TEXTURE_PAIR_PROFILE?100:10,textureSize:512}]}}} as unknown as Artwork;
 const cms=new Cms(),snapshot=vi.spyOn(cms,'studioArtwork').mockResolvedValue({artwork,previewUrl:'/unused'});
 const original=vi.spyOn(cms,'approvedVariantOriginal').mockImplementation(async(_c,_s,_id,asset)=>asset===fullId?full:coarse);
 const derivative=vi.spyOn(cms,'displayApprovedVariant').mockImplementation(async(_c,_s,_id,asset)=>({original:asset===fullId?full:coarse,bytes:display,mime:'model/gltf-binary'}));
 return {cms,artwork,full,coarse,display,snapshot,original,derivative};
}
it.each([BUDGET_GEOMETRY_PAIR_PROFILE,NEAR_GEOMETRY_PAIR_PROFILE,NEAR_TEXTURE_PAIR_PROFILE])('returns the selected display copy only after the exact %s pair qualifier and rechecks',async profile=>{
 const t=setup(profile),budget=vi.spyOn(qualifiers,'qualifyApprovedCompactGeometryPair').mockReturnValue({full:{triangles:100,textureSize:1024},coarse:{triangles:10,textureSize:512}}),near=vi.spyOn(qualifiers,'qualifyApprovedNearGeometryPair').mockImplementation(()=>{}),texture=vi.spyOn(qualifiers,'qualifyApprovedTextureDerivativePair').mockReturnValue({full:{triangles:100,textureSize:1024},coarse:{triangles:100,textureSize:512}});
 const result=await t.cms.displaySelectedVariant(c,session,id,coarseId.toUpperCase(),7);
 expect(result).toEqual({bytes:t.display,mime:'model/gltf-binary',revision:7,assetId:coarseId,watermarked:false,watermarkMode:'none'});
 expect(t.derivative).toHaveBeenCalledExactlyOnceWith(c,session,id,coarseId,7);
 const selected=profile===BUDGET_GEOMETRY_PAIR_PROFILE?budget:profile===NEAR_GEOMETRY_PAIR_PROFILE?near:texture;
 expect(selected).toHaveBeenCalledOnce();expect(selected.mock.calls[0]?.slice(0,2)).toEqual([t.full,t.coarse]);
 expect([budget,near,texture].filter(x=>x.mock.calls.length)).toHaveLength(1);
 expect(t.original.mock.calls.map(x=>x[3])).toEqual([fullId,coarseId,fullId,coarseId]);expect(t.snapshot).toHaveBeenCalledTimes(2);
});
it('rejects stale revision, foreign inventory, unsupported profile and invalid parameters before source reads',async()=>{
 const t=setup();
 await expect(t.cms.displaySelectedVariant(c,session,id,coarseId,8)).rejects.toMatchObject({code:'REVISION_CONFLICT'});
 await expect(t.cms.displaySelectedVariant(c,session,id,'10000000-0000-4000-8000-000000000099',7)).rejects.toMatchObject({code:'APPROVED_LOD_INVALID'});
 (t.artwork.extensions![LOD_NAMESPACE] as {profile:string}).profile='unqualified';
 await expect(t.cms.displaySelectedVariant(c,session,id,coarseId,7)).rejects.toMatchObject({code:'APPROVED_LOD_INVALID'});
 for(const revision of [0,NaN,1.5,2147483648])await expect(t.cms.displaySelectedVariant(c,session,id,coarseId,revision)).rejects.toMatchObject({code:'INVALID_INPUT'});
 expect(t.original).not.toHaveBeenCalled();expect(t.derivative).not.toHaveBeenCalled();
});
it('does not turn declared metrics into qualification or return primary bytes on rejection',async()=>{
 const t=setup();await expect(t.cms.displaySelectedVariant(c,session,id,coarseId,7)).rejects.toMatchObject({code:'APPROVED_LOD_INVALID'});expect(t.derivative).not.toHaveBeenCalled();
});
it.each(['rights','selected-bytes','other-source','current-binding'])('fails closed when %s changes before returning the selected body',async change=>{
 const t=setup();vi.spyOn(qualifiers,'qualifyApprovedCompactGeometryPair').mockReturnValue({full:{triangles:100,textureSize:1024},coarse:{triangles:10,textureSize:512}});
 if(change==='rights')t.original.mockResolvedValueOnce(t.full).mockResolvedValueOnce(t.coarse).mockRejectedValueOnce(new ApiError(403,'RIGHTS_DENIED'));
 if(change==='selected-bytes')t.derivative.mockResolvedValueOnce({original:t.full,bytes:t.display,mime:'model/gltf-binary'});
 if(change==='other-source')t.original.mockResolvedValueOnce(t.full).mockResolvedValueOnce(t.coarse).mockResolvedValueOnce(Buffer.from('changed'));
 if(change==='current-binding')t.snapshot.mockResolvedValueOnce({artwork:t.artwork,previewUrl:'/unused'}).mockResolvedValueOnce({artwork:{...t.artwork,revision:8},previewUrl:'/unused'});
 await expect(t.cms.displaySelectedVariant(c,session,id,coarseId,7)).rejects.toMatchObject({code:change==='rights'?'RIGHTS_DENIED':change==='current-binding'?'REVISION_CONFLICT':'ASSET_INTEGRITY'});
});
