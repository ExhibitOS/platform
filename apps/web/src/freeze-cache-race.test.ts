// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,describe,it,expect,vi} from 'vitest';
import {clearOfflineAuthority,offlineOperation,saveOfflineAuthority,type OfflineAuthority} from './freeze-cache';
// Controllable IndexedDB boundary, exercising production queue/guard code (native IDB is covered by browser integration).
function cache(){
 const profiles:unknown[]=[],transactions:{oncomplete?:()=>void;onabort?:()=>void;error:null;abort:()=>void;objectStore:()=>{put:(value:unknown,key:string)=>void;delete:(key:string)=>void}}[]=[];
 const db={close(){},transaction(){const tx={error:null,oncomplete:undefined as (()=>void)|undefined,onabort:undefined as (()=>void)|undefined,abort(){queueMicrotask(()=>tx.onabort?.());},objectStore(){return {put(value:unknown,key:string){if(key==='profile')profiles.push(value);},delete(key:string){if(key==='profile')profiles.push('deleted');}};}};transactions.push(tx);return tx;}};
 vi.stubGlobal('indexedDB',{open(){const request={result:db,onsuccess:undefined as (()=>void)|undefined};queueMicrotask(()=>request.onsuccess?.());return request;}});
 return {profiles,transactions};
}
afterEach(()=>vi.unstubAllGlobals());
describe('durable selected profile race',()=>{
 it('logout invalidation commits after an already started profile save and before a new account preparation',async()=>{
  const fake=cache(),old={subjectId:'old'} as OfflineAuthority,next={subjectId:'new'} as OfflineAuthority;
  const saving=saveOfflineAuthority(old);await vi.waitFor(()=>expect(fake.transactions).toHaveLength(1));
  const logout=clearOfflineAuthority(),preparing=saveOfflineAuthority(next);await Promise.resolve();expect(fake.transactions).toHaveLength(1);
  fake.transactions[0]!.oncomplete?.();await saving;await vi.waitFor(()=>expect(fake.transactions).toHaveLength(2));expect(fake.profiles).toEqual([old,'deleted']);
  fake.transactions[1]!.oncomplete?.();await logout;await vi.waitFor(()=>expect(fake.transactions).toHaveLength(3));fake.transactions[2]!.oncomplete?.();await preparing;expect(fake.profiles).toEqual([old,'deleted',next]);
 });
 it('a queued old account save aborts before put when logout changes its generation',async()=>{
  const fake=cache(),generation={current:0},old={subjectId:'old'} as OfflineAuthority;
  const previous=clearOfflineAuthority();await vi.waitFor(()=>expect(fake.transactions).toHaveLength(1));
  const guard=offlineOperation(generation),saving=saveOfflineAuthority(old,guard.assert),rejected=expect(saving).rejects.toThrow('OFFLINE_OPERATION_CANCELLED');generation.current++;
  fake.transactions[0]!.oncomplete?.();await previous;await rejected;expect(fake.profiles).toEqual(['deleted']);
 });
});
