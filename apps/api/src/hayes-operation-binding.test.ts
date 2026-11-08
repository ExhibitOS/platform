// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,expect,it} from 'vitest';
import {parseHayesOperationBinding} from './hayes-operation-binding.ts';
const id='10000000-0000-4000-8000-000000000001';
const valid=()=>({version:1,tenantId:id,workspaceId:id,principalId:id,jobId:id,leaseId:id,attemptId:id,runtimeGeneration:id,artworkId:id,correlationId:id,artworkRevision:1,sourceSha256:'e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6',sourceBytes:8383096});
describe('Hayes operation binding data',()=>{
 it('copies and freezes the complete exact source binding',()=>{const source=valid(),binding=parseHayesOperationBinding(source);source.jobId='changed';expect(binding.jobId).toBe(id);expect(Object.isFrozen(binding)).toBe(true);});
 it.each([{tenantId:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'},{leaseId:'missing'},{attemptId:'00000000-0000-0000-0000-000000000000'},{runtimeGeneration:'1'},{artworkRevision:0},{artworkRevision:1.5},{sourceBytes:8383095},{sourceSha256:'0'.repeat(64)},{unknown:true}])('rejects changed or unrecognized binding %j',change=>{expect(()=>parseHayesOperationBinding({...valid(),...change})).toThrow('HAYES_BINDING_INVALID');});
 it('rejects accessors, hidden keys, symbols and throwing proxies',()=>{const accessor=valid();Object.defineProperty(accessor,'jobId',{enumerable:true,get(){throw Error('secret');}});const hidden=valid();Object.defineProperty(hidden,'jobId',{enumerable:false});Object.assign(hidden,{extra:true});const symbol=Object.assign(valid(),{[Symbol('extra')]:true});const proxy=new Proxy(valid(),{ownKeys(){throw Error('secret');}});for(const value of [accessor,hidden,symbol,proxy])expect(()=>parseHayesOperationBinding(value)).toThrowError(/^HAYES_BINDING_INVALID$/);});
 it('inspects the closed field snapshot only once',()=>{let calls=0;const proxy=new Proxy({...valid(),extra:true},{ownKeys(target){calls++;return calls===1?Reflect.ownKeys(target).filter(k=>k!=='extra'):Reflect.ownKeys(target);}});expect(parseHayesOperationBinding(proxy).jobId).toBe(id);expect(calls).toBe(1);});
 it('rejects missing fields',()=>{const x:Partial<ReturnType<typeof valid>>=valid();delete x.correlationId;expect(()=>parseHayesOperationBinding(x)).toThrow('HAYES_BINDING_INVALID');});
});
