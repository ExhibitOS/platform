// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {offlineOperation,saveOfflineAuthority,listFreezeRecords,addFreezeRecord,type OfflineAuthority,type FreezeRecord} from './freeze-cache';
import {prepareOfflineProfile,stageFreezeRecord} from './OfflineExhibition';
vi.mock('./freeze-cache',async(importOriginal)=>({...await importOriginal<typeof import('./freeze-cache')>(),saveOfflineAuthority:vi.fn(),listFreezeRecords:vi.fn(),addFreezeRecord:vi.fn()}));
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const authority:OfflineAuthority={authority:{origin:'https://source.invalid',keyId:'1'.repeat(64),publicKey:'verified-key'},tenantId:'10000000-0000-4000-8000-000000000001',subjectId:'10000000-0000-4000-8000-000000000002',expiresAt:'2099-01-01T00:00:00Z'};
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('location',{origin:authority.authority.origin});vi.mocked(listFreezeRecords).mockResolvedValue([]);vi.mocked(saveOfflineAuthority).mockResolvedValue();vi.mocked(addFreezeRecord).mockResolvedValue();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('offline account generation races',()=>{
 it('a late authority HTTP response after logout cannot pin the old account or read its list',async()=>{
  const response=deferred<Response>();vi.stubGlobal('fetch',vi.fn(()=>response.promise));const generation={current:0};const result=prepareOfflineProfile(false,offlineOperation(generation));const rejected=expect(result).rejects.toThrow('OFFLINE_OPERATION_CANCELLED');generation.current++;
  response.resolve(Response.json(authority));await rejected;expect(saveOfflineAuthority).not.toHaveBeenCalled();expect(listFreezeRecords).not.toHaveBeenCalled();
 });
 it('a queued authority cache transaction checks generation before mutation after an account switch',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(authority)));const started=deferred<void>(),cache=deferred<void>(),mutated=vi.fn();
  vi.mocked(saveOfflineAuthority).mockImplementation(async(_authority,guard)=>{started.resolve();await cache.promise;guard?.();mutated();});
  const generation={current:0},result=prepareOfflineProfile(false,offlineOperation(generation)),rejected=expect(result).rejects.toThrow('OFFLINE_OPERATION_CANCELLED');await started.promise;generation.current++;cache.resolve();await rejected;
  expect(mutated).not.toHaveBeenCalled();expect(listFreezeRecords).not.toHaveBeenCalled();
 });
 it('completed old-scope package staging cannot reselect or return the old list after logout',async()=>{
  const cache=deferred<void>();vi.mocked(addFreezeRecord).mockReturnValue(cache.promise);const generation={current:0};const record={scope:'old-profile'} as FreezeRecord;
  const result=stageFreezeRecord(record,offlineOperation(generation)),rejected=expect(result).rejects.toThrow('OFFLINE_OPERATION_CANCELLED');generation.current++;cache.resolve();await rejected;expect(listFreezeRecords).not.toHaveBeenCalled();
 });
 it('a current preparation returns only its scoped records and passes a commit-time cache guard',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(authority)));const records=[{scope:'current-profile'} as FreezeRecord];vi.mocked(listFreezeRecords).mockResolvedValue(records);
  const generation={current:0};const result=await prepareOfflineProfile(false,offlineOperation(generation));expect(result).toEqual({authority,records});expect(vi.mocked(saveOfflineAuthority).mock.calls[0]![1]).toBeTypeOf('function');
 });
});
