// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
it('requires the attached import provenance and exact content for imported material maps',async()=>{
 const bytes=Buffer.from('synthetic material'),sha256=createHash('sha256').update(bytes).digest('hex'),key=`${id(2)}/oex-import/${id(5)}/${id(6)}/${id(7)}`;
 const descriptor={id:id(4),version:1,rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Example',permissions:{display:true,download:false,export:true,commercial:true}},maps:{color:{mime:'image/png',bytes:bytes.length,sha256,width:2,height:2,colorSpace:'srgb'}}};
 let proof=true;const query=vi.fn(async(sql:string,args?:unknown[])=>{if(sql.includes('FROM workspace_material_versions'))return {rowCount:1,rows:[{descriptor,object_keys:{color:key}}]};if(sql.includes('FROM workspace_material_import_provenance')){expect(args).toEqual([id(1),id(2),id(3),id(4),1,'color',key,sha256,bytes.length]);return {rowCount:proof?1:0,rows:proof?[{}]:[]};}throw Error('unexpected query');});
 const owner={workspaceId:id(1),tenantId:id(2),principalId:id(3),assertDatabase:vi.fn(async()=>{})},s={tenantId:id(2),userId:id(3),role:'admin'} as Session,store={get:vi.fn(async()=>bytes)} as unknown as BlobStore,service=new WorkspaceMaterialIntakes(store,owner,()=>({valid:true,errors:[]})),c={query} as unknown as PoolClient;
 expect(await service.preview(c,s,id(4),1,'color')).toMatchObject({bytes,sha256});expect(await service.exportMap(c,s,id(4),1,'color')).toMatchObject({bytes,sha256});
 proof=false;await expect(service.exportMap(c,s,id(4),1,'color')).rejects.toMatchObject({code:'ASSET_INTEGRITY'});
});
