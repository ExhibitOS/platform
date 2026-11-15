// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import {applyFurnishingCommand,furnishingsFor,furnishingCatalogueEntry} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {newLight} from '../../web/src/placement/model.ts';
import {viewerBudgetAssetSource,readViewerBudgetSource} from './viewer-budget-producer.ts';
import type {Session} from './auth.ts';
function fixture(){
 const draft=newDraft(),light=newLight(draft.candidate.rooms[0]!.id,'spot');light.transform.position=[0,2,0];draft.candidate.lights.push(light);
 draft.candidate=applyFurnishingCommand(draft.candidate,{type:'set-furnishing-visual',hostKind:'light',hostId:light.id,catalogId:'museum-track-spot',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}});
 const asset=furnishingsFor(draft.candidate)!.assets[0]!,session={tenantId:randomUUID(),userId:randomUUID(),role:'artist'} as Session;
 return {draft,asset,session,reference:{kind:'furnishing' as const,assetId:asset.id,catalogVersion:asset.catalogVersion,sha256:asset.sha256,bytes:asset.bytes,mime:asset.mime}};
}
it('resolves the actual selected installed museum GLB through fixed catalogue paths and verified bytes',async()=>{
 const f=fixture(),query=vi.fn<(sql:string,args:unknown[])=>Promise<{rows:never[];rowCount:number}>>().mockResolvedValue({rows:[],rowCount:0}),source=await viewerBudgetAssetSource({query} as unknown as PoolClient,f.session,f.draft.candidate,f.reference);
 expect(query.mock.calls[0]?.[1]).toEqual([f.session.tenantId,f.draft.exhibitionId,f.asset.catalogId,f.asset.catalogVersion]);
 const bytes=await readViewerBudgetSource(source);expect(bytes.length).toBe(f.asset.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.asset.sha256);expect(bytes.subarray(0,4).toString()).toBe('glTF');
});
it('rejects unselected identities and catalogue versions before any source lookup',async()=>{
 const f=fixture(),query=vi.fn(),c={query} as unknown as PoolClient;
 for(const reference of [{...f.reference,assetId:randomUUID()},{...f.reference,catalogVersion:99}])await expect(viewerBudgetAssetSource(c,f.session,f.draft.candidate,reference)).rejects.toMatchObject({code:'FURNISHING_VERSION_MISMATCH'});
 expect(query).not.toHaveBeenCalled();
});
it('preserves imported pair authority, performs blob reads after acquisition and never falls back from a damaged half-pair',async()=>{
 const f=fixture(),entry=furnishingCatalogueEntry(f.asset.catalogId),model=await readFile(new URL('../../../'+entry.path,import.meta.url)),notice=await readFile(new URL('../../../'+entry.rights.noticePath,import.meta.url));
 const rows=[{role:'model',resource_path:entry.path,bytes:f.asset.bytes,sha256:f.asset.sha256,object_key:f.session.tenantId+'/model'},{role:'notice',resource_path:entry.rights.noticePath,bytes:f.asset.rights.notice.bytes,sha256:f.asset.rights.notice.sha256,object_key:f.session.tenantId+'/notice'}];
 const query=vi.fn(async()=>({rows,rowCount:rows.length})),get=vi.fn(async(key:string)=>key.endsWith('/model')?model:notice),blobs={get} as unknown as BlobStore,c={query} as unknown as PoolClient;
 const source=await viewerBudgetAssetSource(c,f.session,f.draft.candidate,f.reference,undefined,undefined,blobs);expect(get).not.toHaveBeenCalled();expect(await readViewerBudgetSource(source)).toEqual(model);expect(get).toHaveBeenCalledTimes(2);
 rows.pop();get.mockClear();await expect(viewerBudgetAssetSource(c,f.session,f.draft.candidate,f.reference,undefined,undefined,blobs)).rejects.toMatchObject({code:'FURNISHING_INTEGRITY'});expect(get).not.toHaveBeenCalled();
});
