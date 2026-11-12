// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {expect,it,vi} from 'vitest';
import {Cms} from './cms.ts';
import type {Session} from './auth.ts';
const fixture=()=>({tenantId:randomUUID(),userId:randomUUID(),role:'admin'} as Session);
it('ordinary primary approval cannot select a prepared GPU candidate, even when its asset is approved',async()=>{
 const cms=new Cms(),session=fixture(),id=randomUUID(),assetId=randomUUID(),own=vi.spyOn(cms,'ownArtwork').mockResolvedValue({revision:7,metadata:{}} as never);
 const query=vi.fn().mockResolvedValue({rows:[{selected:1}],rowCount:1}),c={query} as unknown as PoolClient;
 await expect(cms.approve(c,session,id,{revision:7,assetId})).rejects.toMatchObject({status:409,code:'GPU_MODEL_EXPLICIT_APPROVAL_REQUIRED'});
 expect(own).toHaveBeenCalledWith(c,session,id);expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0]![1]).toEqual([session.tenantId,id,assetId]);expect(String(query.mock.calls[0]![0])).toContain("to_jsonb(j)->>'gpu_preparation'");
});
it('artwork ownership is checked before probing derivative membership or exposing its existence',async()=>{
 const cms=new Cms(),session=fixture(),query=vi.fn(),c={query} as unknown as PoolClient;
 vi.spyOn(cms,'ownArtwork').mockRejectedValue(Object.assign(Error('denied'),{status:403,code:'FORBIDDEN'}));
 await expect(cms.approve(c,session,randomUUID(),{revision:1,assetId:randomUUID()})).rejects.toMatchObject({status:403,code:'FORBIDDEN'});expect(query).not.toHaveBeenCalled();
});
it('ordinary source assets still reach their existing metadata checks when optional GPU schema is absent',async()=>{
 const cms=new Cms(),session=fixture(),query=vi.fn().mockResolvedValue({rows:[],rowCount:0}),c={query} as unknown as PoolClient;
 vi.spyOn(cms,'ownArtwork').mockResolvedValue({revision:1,metadata:{}} as never);
 await expect(cms.approve(c,session,randomUUID(),{revision:1,assetId:randomUUID()})).rejects.toMatchObject({status:400,code:'INVALID_METADATA'});expect(query).toHaveBeenCalledTimes(1);
});
