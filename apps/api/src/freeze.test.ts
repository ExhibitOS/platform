// SPDX-License-Identifier: AGPL-3.0-or-later
import {generateKeyPairSync,createPublicKey} from 'node:crypto';
import {mkdtemp,writeFile,chmod,symlink,realpath,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it,expect} from 'vitest';
import {freezeCanonical,freezeFileMime,FREEZE_VERSION} from '@exhibitos/studio-contract';
import {sha256,type BlobStore} from '@exhibitos/storage';
import type {Pool} from 'pg';
import type {Session} from './auth.ts';
import {Freezes,loadFreezeConfig,loadFreezeRuntime,offlineDeadline} from './freeze.ts';
const digest=(v:unknown)=>sha256(Buffer.from(freezeCanonical(v)));
async function root(){return realpath(await mkdtemp(join(tmpdir(),'exhibitos-freeze-unit-')));}
async function runtime(dir:string){
 const entries=[['index.html','<!doctype html><title>Synthetic offline runtime</title>'],['THIRD_PARTY_NOTICES.txt','Synthetic license notice'],['offline-server.mjs','// synthetic local-only HTTP server entry']].map(([path,text])=>({path:path!,data:Buffer.from(text!)}));
 for(const file of entries)await writeFile(join(dir,file.path),file.data);
 const files=entries.map(x=>({path:x.path,bytes:x.data.length,sha256:sha256(x.data),mime:freezeFileMime(x.path)!})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 await writeFile(join(dir,'studio-sw.js'),'// Synthetic offline cache worker');
 await writeFile(join(dir,'freeze-runtime.json'),JSON.stringify({schemaVersion:FREEZE_VERSION,version:'0.1.0',coreDigest:digest(files),files}));
 return {entries,files};
}
describe('signed freeze service boundaries',()=>{
 it('loads only explicit0600 Ed25519 PKCS8 config and denies wrong modes, symlinks and malformed key without revealing contents',async()=>{
  const dir=await root(),{privateKey}=generateKeyPairSync('ed25519'),key=join(dir,'key.json');
  await writeFile(key,JSON.stringify({schemaVersion:FREEZE_VERSION,name:'exhibitos-freeze-ed25519',privateKey:privateKey.export({format:'der',type:'pkcs8'}).toString('base64')}),{mode:0o600});
  const config=await loadFreezeConfig({runtimeRoot:dir,signingKeyFile:key,origin:'http://127.0.0.1:3000'});expect(config.signingKey.asymmetricKeyType).toBe('ed25519');
  const freezes=new Freezes({}as Pool,{}as BlobStore,config);expect(freezes.authority.publicKey).toBe(createPublicKey(privateKey).export({format:'der',type:'spki'}).toString('base64'));
  await chmod(key,0o644);await expect(loadFreezeConfig({runtimeRoot:dir,signingKeyFile:key,origin:config.origin})).rejects.toMatchObject({code:'FREEZE_CONFIG_INVALID'});await chmod(key,0o600);
  const alias=join(dir,'alias.json');await symlink(key,alias);await expect(loadFreezeConfig({runtimeRoot:dir,signingKeyFile:alias,origin:config.origin})).rejects.toMatchObject({code:'FREEZE_CONFIG_INVALID'});
  await writeFile(key,'private invalid contents');await expect(loadFreezeConfig({runtimeRoot:dir,signingKeyFile:key,origin:config.origin})).rejects.toMatchObject({code:'FREEZE_CONFIG_INVALID'});
 });
 it('pins and retains each real runtime byte including descriptor/worker and rejects missing, tampered or symlinked files',async()=>{
  const dir=await root();await runtime(dir);const first=await loadFreezeRuntime(dir);expect(first.files.size).toBe(5);expect(first.runtime.imageDigest).toBe(digest(first.runtime.files));
  const old=first.files.get('index.html')!.toString();await writeFile(join(dir,'index.html'),'tampered');await expect(loadFreezeRuntime(dir)).rejects.toMatchObject({code:'FREEZE_RUNTIME_INVALID'});expect(first.files.get('index.html')!.toString()).toBe(old);
  await runtime(dir);const outside=await root();await writeFile(join(outside,'external.txt'),'Synthetic external text');await writeFile(join(dir,'index.html'),'placeholder');
  const {unlink}=await import('node:fs/promises');await unlink(join(dir,'index.html'));await symlink(join(outside,'external.txt'),join(dir,'index.html'));await expect(loadFreezeRuntime(dir)).rejects.toMatchObject({code:'FREEZE_RUNTIME_INVALID'});
 });
 it('rejects a real parent traversal descriptor even when its outside bytes and digest exactly match and MIME is null',async()=>{
  const base=await root(),dir=join(base,'runtime');await mkdir(dir);const {files}=await runtime(dir),outside=Buffer.from('Synthetic outside file must not enter runtime');await writeFile(join(base,'outside.txt'),outside);
  const malformed=[...files,{path:'../outside.txt',bytes:outside.length,sha256:sha256(outside),mime:null}].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  await writeFile(join(dir,'freeze-runtime.json'),JSON.stringify({schemaVersion:FREEZE_VERSION,version:'0.1.0',coreDigest:digest(malformed),files:malformed}));
  await expect(loadFreezeRuntime(dir)).rejects.toMatchObject({code:'FREEZE_RUNTIME_INVALID'});
 });
 it('caps disconnected display at requested interval, session expiry and each current or historical governing expiry',()=>{
  const now=Date.parse('2026-10-03T00:00:00Z'),s={expiresAt:new Date(now+3600000).toISOString()}as Session;
  expect(offlineDeadline(s,28800,[],now)).toBe(new Date(now+3600000).toISOString());
  expect(offlineDeadline(s,60,[{expiresAt:new Date(now+20000).toISOString()}],now)).toBe(new Date(now+20000).toISOString());
  for(const seconds of [0,28801,1.5,NaN])expect(()=>offlineDeadline(s,seconds,[],now)).toThrow('OFFLINE_INTERVAL_INVALID');
  expect(()=>offlineDeadline({...s,expiresAt:new Date(now-1).toISOString()},60,[],now)).toThrow('OFFLINE_GRANT_EXPIRED');
 });
});
