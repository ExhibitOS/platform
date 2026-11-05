// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {sha256,type BlobStore} from '@exhibitos/storage';
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';
it('rechecks the display grant after the blob read and does not return expired bytes',async()=>{
 const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,bytes=Buffer.from('synthetic');
 const rights={holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:false,export:false,commercial:false},expiresAt:'2026-11-06T00:00:00Z'};
 const row={descriptor:{rights,maps:{color:{mime:'image/png',bytes:bytes.length,sha256:sha256(bytes)}}},object_keys:{color:`${id(2)}/workspace-material-intake/${id(1)}/synthetic/color/${sha256(bytes)}`}};
 const c={query:vi.fn(async()=>({rowCount:1,rows:[row]}))} as unknown as PoolClient;
 const s={id:id(4),tenantId:id(2),userId:id(3),role:'admin',csrfToken:'',expiresAt:'2099-01-01T00:00:00Z'} as Session;
 const store={get:async()=>{vi.setSystemTime(new Date('2026-11-06T00:00:01Z'));return bytes;}} as unknown as BlobStore;
 const service=new WorkspaceMaterialIntakes(store,{workspaceId:id(1),tenantId:id(2),principalId:id(3),assertDatabase:async()=>{}},()=>({valid:true,errors:[]}));
 vi.useFakeTimers();try{vi.setSystemTime(new Date('2026-11-05T23:59:59Z'));await expect(service.preview(c,s,id(5),1,'color')).rejects.toMatchObject({code:'DISPLAY_PERMISSION_REQUIRED'});}finally{vi.useRealTimers();}
});
