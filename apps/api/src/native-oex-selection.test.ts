// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Pool} from 'pg';
import {expect,it,vi} from 'vitest';
import {acceptNativeOexSelection} from './native-oex-selection.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(count=1){
 const selection={version:1,kind:'upload-selection',correlationId:id(1),runtimeGeneration:id(2),workspaceId:id(3),tenantId:id(4),principalId:id(5),requestId:id(6),archiveBytes:67108865,archiveSha256:'a'.repeat(64)};
 const expiry=new Date('2099-01-01T00:00:00Z'),query=vi.fn(async(sql:string)=>sql.startsWith('SELECT a.id')?{rowCount:count,rows:Array.from({length:count},(_,i)=>({id:id(7+i),expires_at:expiry}))}:{rows:[]}),client={query,release:vi.fn()},pool={options:{connectionTimeoutMillis:5000},connect:vi.fn(async()=>client)} as unknown as Pool;
 const channel={send:vi.fn(async(_v:Uint8Array)=>{}),receive:vi.fn(async()=>Buffer.from(JSON.stringify(selection))),close:vi.fn(async()=>{})},install=vi.fn(async()=>{}),verifyOwner=vi.fn(async()=>{}),assertDatabase=vi.fn(async()=>{});
 return {selection,pool,channel,install,verifyOwner,assertDatabase};
}
it.skipIf(!process.getuid?.())('binds the sole current personal server Session and echoes the exact selection',async()=>{
 const f=fixture(),result=await acceptNativeOexSelection({pool:f.pool,channel:f.channel,workspaceId:id(3),tenantId:id(4),principalId:id(5),runtimeGeneration:id(2),ownerUid:process.getuid!(),verifyOwner:f.verifyOwner,assertDatabase:f.assertDatabase,install:f.install,signal:new AbortController().signal});
 expect(result.selection.sessionId).toBe(id(7));expect(f.install).toHaveBeenCalledWith(result.selection);expect(result.expiresAt).toBe(Date.parse('2099-01-01T00:00:00Z'));expect(f.channel.receive).toHaveBeenCalledWith(0);
 expect(Buffer.from(f.channel.send.mock.calls[1]![0]).toString()).toBe(JSON.stringify({...f.selection,kind:'upload-selected'}));
});
it.skipIf(!process.getuid?.())('refuses ambiguous current sessions before installing upload authority',async()=>{
 const f=fixture(2);await expect(acceptNativeOexSelection({pool:f.pool,channel:f.channel,workspaceId:id(3),tenantId:id(4),principalId:id(5),runtimeGeneration:id(2),ownerUid:process.getuid!(),verifyOwner:f.verifyOwner,assertDatabase:f.assertDatabase,install:f.install,signal:new AbortController().signal})).rejects.toThrow('NATIVE_OEX_SELECTION');expect(f.install).not.toHaveBeenCalled();expect(f.channel.close).toHaveBeenCalledOnce();
});
it.skipIf(!process.getuid?.())('does not acknowledge until asynchronous slot installation succeeds',async()=>{
 const f=fixture();f.install.mockRejectedValueOnce(Error('owner lost'));await expect(acceptNativeOexSelection({pool:f.pool,channel:f.channel,workspaceId:id(3),tenantId:id(4),principalId:id(5),runtimeGeneration:id(2),ownerUid:process.getuid!(),verifyOwner:f.verifyOwner,assertDatabase:f.assertDatabase,install:f.install,signal:new AbortController().signal})).rejects.toThrow('owner lost');expect(f.channel.send).toHaveBeenCalledOnce();expect(f.channel.close).toHaveBeenCalledOnce();
});
