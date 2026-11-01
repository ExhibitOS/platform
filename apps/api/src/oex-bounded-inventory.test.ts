// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import {expect,it,vi} from 'vitest';
import type {Session} from './auth.ts';
import {recordBoundedOexDestinations} from './oex-bounded-inventory.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const session={tenantId:id(1),userId:id(2),role:'artist'} as Session;
function client(valid=true){let probe='';return {query:vi.fn(async(sql:string,args?:unknown[])=>{
 if(sql.includes('set_config')){probe=String(args![0]);return {rows:[],rowCount:1};}
 if(sql.includes('transaction_isolation'))return {rows:[{isolation:'read committed',probe}],rowCount:1};
 if(sql.startsWith('UPDATE'))return {rows:valid?[{id:id(3)}]:[],rowCount:valid?1:0};throw Error('unexpected query');
 })};}
it('records unique scoped keys before returning any destination mapping',async()=>{
 const c=client(),result=await recordBoundedOexDestinations(c as unknown as PoolClient,session,id(3),id(4),id(5),['assets/a','assets/b']);
 expect(result.size).toBe(2);const keys=[...result.values()];expect(new Set(keys).size).toBe(2);expect(keys.every(k=>k.startsWith(`${session.tenantId}/oex-import/${id(3)}/${id(5)}/`))).toBe(true);
 const args=c.query.mock.calls[2]![1]!;expect(JSON.parse(String(args[4]))).toEqual(keys);
});
it('refuses duplicate source paths and a row whose active lease is unavailable',async()=>{
 const a=client();await expect(recordBoundedOexDestinations(a as unknown as PoolClient,session,id(3),id(4),id(5),['same','same'])).rejects.toThrow('INVALID_INPUT');expect(a.query).not.toHaveBeenCalled();
 const b=client(false);await expect(recordBoundedOexDestinations(b as unknown as PoolClient,session,id(3),id(4),id(5),['assets/a'])).rejects.toThrow('OEX_INVENTORY_UNAVAILABLE');
});
