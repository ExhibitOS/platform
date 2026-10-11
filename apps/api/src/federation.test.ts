// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {federationOrigin,publicAddress,validateDiscovery,type DiscoveryPayload} from './federation.ts';
const keys=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');
const publicKey=keys.publicKey.export({format:'der',type:'spki'}).toString('base64');
const now=Date.now(),origin='https://museum.example.com',id='12345678-1234-4234-8234-123456789012';
const payload:DiscoveryPayload={version:1,origin,publicKey,sequence:1,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+60_000).toISOString(),items:[{publicationId:id,title:'Synthetic public exhibition',url:origin+'/p/'+id,revisionSha256:'a'.repeat(64),publishedAt:new Date(now-1000).toISOString()}]};
const envelope=(p:unknown,key=keys.privateKey)=>{const text=JSON.stringify(p);return {payload:text,signature:sign(null,Buffer.from(text),key).toString('hex')};};
describe('Public federation admission',()=>{
 it('accepts a pinned Ed25519 identity and explicit bounded public projection',()=>{expect(validateDiscovery(envelope(payload),origin,publicKey,now)).toEqual(payload);});
 it('refuses forged signatures, wrong server identity, stale snapshots and private extra metadata',()=>{
  const altered={...envelope(payload),payload:JSON.stringify({...payload,sequence:2})};expect(()=>validateDiscovery(altered,origin,publicKey,now)).toThrow('FEDERATION_SIGNATURE');
  expect(()=>validateDiscovery(envelope(payload,other.privateKey),origin,publicKey,now)).toThrow('FEDERATION_SIGNATURE');
  for(const p of [{...payload,origin:'https://other.example.com'},{...payload,version:2},{...payload,expiresAt:new Date(now-1).toISOString()},{...payload,issuedAt:'invalid'},{...payload,items:[{...payload.items[0],model:'private.glb'}]}])expect(()=>validateDiscovery(envelope(p),origin,publicKey,now)).toThrow();
 });
 it('refuses private/redirected viewer links and spam before cache replacement',()=>{
  for(const url of ['http://127.0.0.1/p/'+id,'https://other.example.com/p/'+id,origin+'/p/'+id+'?token=private',origin+'/p/'+id+'#redirect'])expect(()=>validateDiscovery(envelope({...payload,items:[{...payload.items[0],url}]}),origin,publicKey,now)).toThrow('FEDERATION_URL');
  expect(()=>validateDiscovery(envelope({...payload,items:Array(201).fill(payload.items[0])}),origin,publicKey,now)).toThrow();
  expect(()=>validateDiscovery(envelope({...payload,items:[payload.items[0],payload.items[0]]}),origin,publicKey,now)).toThrow();
 });
 it('rejects private, mapped, multicast, documentation and local network destinations',()=>{
  for(const ip of ['0.0.0.0','127.0.0.1','10.2.3.4','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','198.18.0.1','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])expect(publicAddress(ip)).toBe(false);
  expect(publicAddress('8.8.8.8')).toBe(true);expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  for(const url of ['http://museum.example.com','https://127.0.0.1','https://localhost','https://museum.internal','https://museum.example.com/path','https://user@museum.example.com','https://museum.example.com:8443','https://museum.example.com.'])expect(()=>federationOrigin(url)).toThrow('FEDERATION_URL');
 });
});
