// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,readdir,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import type {Pool,PoolClient} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {buildApp} from './app.ts';
import {Auth,type Session} from './auth.ts';
import {Studio,etag} from './studio.ts';
import {Publications} from './publication.ts';
import type {NativeLocalExportContext} from './native-oex-provenance.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('waits for selected producer and cleanup after a real client disconnect during shutdown',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'native-publication-http-')));roots.push(root);const store=join(root,'blobs');await mkdir(store,{mode:0o700});const blobs=new FileBlobStore(store),draft=newDraft(),revision=1,match=etag(revision,draft);
 const session={id:randomUUID(),tenantId:randomUUID(),userId:randomUUID(),role:'admin',expiresAt:'2099-01-01T00:00:00Z'} as Session,c={query:vi.fn(async()=>({rows:[]}))} as unknown as PoolClient,context={workspaceId:randomUUID(),tenantId:session.tenantId,principalId:session.userId,assertDatabase:async()=>{}} as unknown as NativeLocalExportContext;
 vi.spyOn(Auth.prototype,'request').mockImplementation(async(_token,_tenant,_csrf,_mutate,work)=>work(c,session));
 vi.spyOn(Studio.prototype,'access').mockResolvedValue({revision,metadata:draft} as never);
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
 vi.spyOn(Publications.prototype,'ready').mockImplementation(async(client,s,id,op)=>{if(!op)throw Error('missing selected stage');const stage=await op.claim(client,s,blobs,'readiness',id,match);if('markEffectsPossible' in op)op.markEffectsPossible();await stage.append(Buffer.from('test'));entered();await gate;await stage.close();await op.close();return {status:'READY',etag:match,issues:[]};});
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const address=probe.address();if(!address||typeof address==='string')throw Error('no port');const port=address.port;await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
 const app=buildApp({pool:{} as Pool,auth:{mode:'local',origin:`http://127.0.0.1:${port}`,bindHost:'127.0.0.1'},blobs,nativeExportWorkspace:context});await app.listen({port,host:'127.0.0.1'});
 const controller=new AbortController(),fetching=fetch(`http://127.0.0.1:${port}/api/v1/tenants/${session.tenantId}/studio/exhibitions/${draft.exhibitionId}/ready`,{headers:{'if-match':match,'x-exhibitos-publication-profile':'bounded-local-v1'},signal:controller.signal}).catch(()=>undefined);
 try{const first=await Promise.race([started.then(()=>undefined),fetching.then(async response=>response?`${response.status} ${await response.text()}`:'fetch failed')]);if(first)throw Error('producer did not start: '+first);expect(c.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock_shared(82002)');controller.abort();let done=false;const closing=app.close().then(()=>{done=true;});await new Promise(r=>setTimeout(r,50));expect(done).toBe(false);release();await closing;await fetching;expect(done).toBe(true);}finally{release();await app.close();await fetching;}
});
it('keeps legacy readiness separate and rejects a stale selected draft before admission',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'native-publication-route-')));roots.push(root);const store=join(root,'blobs');await mkdir(store,{mode:0o700});const blobs=new FileBlobStore(store),draft=newDraft(),match=etag(1,draft);
 const session={id:randomUUID(),tenantId:randomUUID(),userId:randomUUID(),role:'admin',expiresAt:'2099-01-01T00:00:00Z'} as Session,c={query:vi.fn(async()=>({rows:[]}))} as unknown as PoolClient,context={workspaceId:randomUUID(),tenantId:session.tenantId,principalId:session.userId,assertDatabase:async()=>{}} as unknown as NativeLocalExportContext;
 vi.spyOn(Auth.prototype,'request').mockImplementation(async(_token,_tenant,_csrf,_mutate,work)=>work(c,session));vi.spyOn(Studio.prototype,'access').mockResolvedValue({revision:1,metadata:draft} as never);
 const ready=vi.spyOn(Publications.prototype,'ready').mockResolvedValue({status:'READY',etag:match,issues:[]}),app=buildApp({pool:{} as Pool,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},blobs,nativeExportWorkspace:context});
 try{const url=`/api/v1/tenants/${session.tenantId}/studio/exhibitions/${draft.exhibitionId}/ready`,headers={host:'127.0.0.1:13200'};
  expect((await app.inject({method:'GET',url,headers})).statusCode).toBe(200);expect(ready.mock.calls[0]?.[3]).toBeUndefined();
  const stale=await app.inject({method:'GET',url,headers:{...headers,'if-match':'"studio-r1-'+ 'b'.repeat(64)+'"','x-exhibitos-publication-profile':'bounded-local-v1'}});expect(stale.statusCode).toBe(412);expect(ready).toHaveBeenCalledTimes(1);
  const missing=await app.inject({method:'GET',url,headers:{...headers,'x-exhibitos-publication-profile':'bounded-local-v1'}});expect(missing.statusCode).toBe(428);expect(ready).toHaveBeenCalledTimes(1);
 }finally{await app.close();}
});
it('returns an authenticated committed retry without adopting an unknown marker',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'native-publication-replay-')));roots.push(root);const store=join(root,'blobs');await mkdir(store,{mode:0o700});const blobs=new FileBlobStore(store),draft=newDraft(),match=etag(1,draft),requestId=randomUUID();
 const session={id:randomUUID(),tenantId:randomUUID(),userId:randomUUID(),role:'admin',expiresAt:'2099-01-01T00:00:00Z'} as Session,c={query:vi.fn(async()=>({rows:[]}))} as unknown as PoolClient,verify=vi.fn(async()=>{}),context={workspaceId:randomUUID(),tenantId:session.tenantId,principalId:session.userId,assertDatabase:verify} as unknown as NativeLocalExportContext;
 vi.spyOn(Auth.prototype,'request').mockImplementation(async(_token,_tenant,_csrf,_mutate,work)=>work(c,session));vi.spyOn(Publications.prototype,'existingRequest').mockResolvedValue({publicationId:randomUUID(),status:'published'} as never);const create=vi.spyOn((await import('./native-local-publication-stage.ts')).NativeLocalPublicationStage,'create');
 const app=buildApp({pool:{} as Pool,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},blobs,nativeExportWorkspace:context});
 try{const result=await app.inject({method:'POST',url:`/api/v1/tenants/${session.tenantId}/studio/exhibitions/${draft.exhibitionId}/publications`,headers:{host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200','if-match':match,'x-exhibitos-publication-profile':'bounded-local-v1'},payload:{requestId}});expect(result.statusCode).toBe(201);expect(verify).toHaveBeenCalled();expect(create).not.toHaveBeenCalled();}finally{await app.close();}
});
it('rejects original publication without a native detail owner before source admission',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'native-original-denied-')));roots.push(root);const store=join(root,'blobs');await mkdir(store,{mode:0o700});const blobs=new FileBlobStore(store),draft=newDraft(),tenantId=randomUUID(),prepare=vi.spyOn(Publications.prototype,'publish');
 const app=buildApp({pool:{} as Pool,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},blobs});
 try{const result=await app.inject({method:'POST',url:`/api/v1/tenants/${tenantId}/studio/exhibitions/${draft.exhibitionId}/publications`,headers:{host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200','if-match':etag(1,draft),'x-exhibitos-publication-profile':'native-original-v1'},payload:{requestId:randomUUID()}});expect(result.statusCode).toBe(409);expect(prepare).not.toHaveBeenCalled();}finally{await app.close();}
});

it('releases the owned stage after rejected ordinary audio preparation', async () => {
 const root = await realpath(await mkdtemp(join(tmpdir(), 'native-publication-rejected-audio-')));
 roots.push(root);
 const storage = join(root, 'blobs');
 await mkdir(storage, {mode: 0o700});
 const blobs = new FileBlobStore(storage);
 const draft = newDraft();
 const audioId = randomUUID();
 draft.candidate.mediaAssets.push({
  id: audioId, path: `media/${audioId}/audio.wav`, mime: 'audio/wav', bytes: 32044, sha256: 'a'.repeat(64),
  rights: {holder: 'Synthetic', ownership: 'owner', licenseId: 'CC0-1.0', creditLine: 'Synthetic',
   permissions: {display: true, export: true, download: true, commercial: true}},
 });
 const match = etag(1, draft);
 const session = {id: randomUUID(), tenantId: randomUUID(), userId: randomUUID(), role: 'admin', expiresAt: '2099-01-01T00:00:00Z'} as Session;
 const query = vi.fn(async () => ({rows: []}));
 const c = {query} as unknown as PoolClient;
 const context = {workspaceId: randomUUID(), tenantId: session.tenantId, principalId: session.userId, assertDatabase: async () => {}} as NativeLocalExportContext;
 vi.spyOn(Auth.prototype, 'request').mockImplementation(async (_token, _tenant, _csrf, _mutate, work) => work(c, session));
 vi.spyOn(Studio.prototype, 'access').mockResolvedValue({revision: 1, metadata: draft} as never);
 const app = buildApp({pool: {} as Pool, auth: {mode: 'local', origin: 'http://127.0.0.1:13200', bindHost: '127.0.0.1'}, blobs, nativeExportWorkspace: context});
 const base = `/api/v1/tenants/${session.tenantId}/studio/exhibitions/${draft.exhibitionId}`;
 const headers = {host: '127.0.0.1:13200', origin: 'http://127.0.0.1:13200', 'if-match': match, 'x-exhibitos-publication-profile': 'bounded-local-v1'};
 try {
  const rejected = await app.inject({method: 'POST', url: base + '/publications', headers, payload: {requestId: randomUUID()}});
  expect(rejected.statusCode).toBe(422);
  expect(rejected.json()).toMatchObject({code: 'PUBLICATION_NOT_READY'});
  expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM studio_audio'), [session.tenantId, draft.exhibitionId, audioId]);
  expect(await readdir(root)).toEqual(['blobs']);
  expect(await readdir(storage)).toEqual([]);
  const readiness = await app.inject({method: 'GET', url: base + '/ready', headers});
  expect(readiness.statusCode).toBe(200);
  expect(readiness.json()).toMatchObject({status: 'BLOCKED', issues: [{code: 'FORBIDDEN', path: '/candidate/mediaAssets/0'}]});
 } finally {await app.close();}
});
