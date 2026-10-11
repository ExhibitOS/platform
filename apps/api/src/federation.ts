// SPDX-License-Identifier: AGPL-3.0-or-later
import {createPrivateKey,createPublicKey,sign,verify,randomUUID,type KeyObject} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request} from 'node:https';
import type {Pool,PoolClient} from 'pg';
import {transaction} from '@exhibitos/storage';
import {ApiError,uuid} from './auth.ts';
export const FEDERATION_PATH='/api/v1/federation/discovery';
export const FEDERATION_MAX_BYTES=256*1024;
const MAX_ITEMS=200,MAX_PEERS=64,TTL=3600_000;
export interface DiscoveryItem{publicationId:string;title:string;url:string;revisionSha256:string;publishedAt:string}
export interface DiscoveryPayload{version:1;origin:string;publicKey:string;sequence:number;issuedAt:string;expiresAt:string;items:DiscoveryItem[]}
export interface DiscoveryEnvelope{payload:string;signature:string}
export interface FederationConfig{origin:string;privateKey:string}
const deny=(code:string)=>new ApiError(400,code);
function object(v:unknown,keys:string[]):asserts v is Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==keys.sort().join('|'))throw deny('FEDERATION_FORMAT');}
function stamp(v:unknown):number{if(typeof v!=='string'||!Number.isFinite(Date.parse(v))||new Date(Date.parse(v)).toISOString()!==v)throw deny('FEDERATION_FORMAT');return Date.parse(v);}
export function publicAddress(address:string):boolean{
 const kind=isIP(address);
 if(kind===4){const [a,b]=address.split('.').map(Number);return a!==undefined&&b!==undefined&&a>0&&a<224&&![10,127].includes(a)&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&[0,168].includes(b))&&!(a===100&&b>=64&&b<=127)&&!(a===198&&[18,19,51].includes(b))&&!(a===203&&b===0);}
 // Only globally routed native IPv6; mapped/compatible/private/link-local rejected.
 if(kind===6)return /^[23][0-9a-f]{3}:/i.test(address)&&!/^2001:(?:0*db8|0*0|0*2):/i.test(address)&&!/^2002:/i.test(address);
 return false;
}
export function federationOrigin(input:string):string{
 let u:URL;try{u=new URL(input);}catch{throw deny('FEDERATION_URL');}
 if(u.origin!==input||u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||u.hostname.endsWith('.')||!u.hostname.includes('.')||u.hostname.length>253)throw deny('FEDERATION_URL');
 const host=u.hostname.replace(/^\[|\]$/g,'');if(isIP(host)&&!publicAddress(host)||/\.(?:local|localhost|internal|invalid|test)$/i.test(host))throw deny('FEDERATION_URL');return u.origin;
}
function publicKey(encoded:string):KeyObject{
 if(!/^[A-Za-z0-9+/]{59}=$/.test(encoded))throw deny('FEDERATION_IDENTITY');
 try{const k=createPublicKey({key:Buffer.from(encoded,'base64'),format:'der',type:'spki'});if(k.asymmetricKeyType!=='ed25519'||k.export({format:'der',type:'spki'}).toString('base64')!==encoded)throw Error();return k;}catch{throw deny('FEDERATION_IDENTITY');}
}
export function validateDiscovery(input:unknown,origin:string,key:string,now=Date.now()):DiscoveryPayload{
 object(input,['payload','signature']);if(typeof input.payload!=='string'||Buffer.byteLength(input.payload)>FEDERATION_MAX_BYTES||typeof input.signature!=='string'||!/^[a-f0-9]{128}$/.test(input.signature))throw deny('FEDERATION_FORMAT');
 if(!verify(null,Buffer.from(input.payload),publicKey(key),Buffer.from(input.signature,'hex')))throw deny('FEDERATION_SIGNATURE');
 let p:unknown;try{p=JSON.parse(input.payload);}catch{throw deny('FEDERATION_FORMAT');}
 object(p,['version','origin','publicKey','sequence','issuedAt','expiresAt','items']);
 if(p.version!==1||p.origin!==federationOrigin(origin)||p.publicKey!==key||!Number.isSafeInteger(p.sequence)||Number(p.sequence)<1||!Array.isArray(p.items)||p.items.length>MAX_ITEMS)throw deny('FEDERATION_FORMAT');
 const issued=stamp(p.issuedAt),expires=stamp(p.expiresAt);if(issued>now+30_000||expires<=now||expires<=issued||expires-issued>TTL)throw deny('FEDERATION_EXPIRED');
 const ids=new Set<string>();for(const raw of p.items){object(raw,['publicationId','title','url','revisionSha256','publishedAt']);uuid(raw.publicationId as string);if(ids.has(raw.publicationId as string)||typeof raw.title!=='string'||raw.title.length<1||raw.title.length>300||Array.from(raw.title).some(char=>char.charCodeAt(0)<32)||typeof raw.revisionSha256!=='string'||!/^[a-f0-9]{64}$/.test(raw.revisionSha256))throw deny('FEDERATION_FORMAT');ids.add(raw.publicationId as string);let u:URL;try{u=new URL(String(raw.url));}catch{throw deny('FEDERATION_URL');}if(u.origin!==origin||u.pathname!==`/p/${raw.publicationId}`||u.search||u.hash||u.username||u.password)throw deny('FEDERATION_URL');if(stamp(raw.publishedAt)>issued)throw deny('FEDERATION_FORMAT');}
 return p as unknown as DiscoveryPayload;
}
/** All DNS answers must be public. Connect only to the inspected address, preserving TLS hostname verification. */
export async function fetchDiscovery(origin:string):Promise<unknown>{
 const u=new URL(FEDERATION_PATH,federationOrigin(origin));let dnsTimer:ReturnType<typeof setTimeout>|undefined;const records=await Promise.race([lookup(u.hostname,{all:true,verbatim:true}),new Promise<never>((_resolve,reject)=>{dnsTimer=setTimeout(()=>reject(deny('FEDERATION_NETWORK')),5000);})]).finally(()=>clearTimeout(dnsTimer));if(!records.length||records.length>16||records.some(r=>!publicAddress(r.address)))throw deny('FEDERATION_SSRF');const pinned=records[0]!;
 return new Promise((resolve,reject)=>{
  const req=request(u,{method:'GET',family:pinned.family,headers:{accept:'application/json'},lookup:(_host,_options,cb)=>cb(null,pinned.address,pinned.family)},res=>{
   if(res.statusCode!==200||String(res.headers['content-type']).split(';')[0]?.trim()!=='application/json'){res.destroy();reject(deny('FEDERATION_RESPONSE'));return;}
   const chunks:Buffer[]=[];let size=0;res.on('data',(b:Buffer)=>{size+=b.length;if(size>FEDERATION_MAX_BYTES){res.destroy();reject(deny('FEDERATION_QUOTA'));}else chunks.push(b);});res.on('error',()=>reject(deny('FEDERATION_NETWORK')));res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(deny('FEDERATION_FORMAT'));}});
  });const deadline=setTimeout(()=>req.destroy(),5000);req.on('close',()=>clearTimeout(deadline));req.setTimeout(5000,()=>req.destroy());req.on('error',()=>reject(deny('FEDERATION_NETWORK')));req.end();
 });
}
export class Federation{
 readonly origin:string;readonly publicKey:string;private readonly key:KeyObject;private readonly pool:Pool;
 constructor(pool:Pool,config:FederationConfig){this.pool=pool;this.origin=federationOrigin(config.origin);this.key=createPrivateKey(config.privateKey);if(this.key.asymmetricKeyType!=='ed25519')throw deny('FEDERATION_IDENTITY');this.publicKey=createPublicKey(this.key).export({format:'der',type:'spki'}).toString('base64');}
 async listing(c:PoolClient,id:string,enabled:boolean){uuid(id);if(typeof enabled!=='boolean')throw deny('FEDERATION_FORMAT');if(enabled){await c.query('SELECT pg_advisory_xact_lock(82103)');if(Number((await c.query('SELECT count(*) FROM federation_listings WHERE enabled')).rows[0].count)>=MAX_ITEMS&&!(await c.query('SELECT 1 FROM federation_listings WHERE publication_id=$1 AND enabled',[id])).rowCount)throw deny('FEDERATION_QUOTA');}await c.query('INSERT INTO federation_listings(publication_id,enabled) VALUES($1,$2) ON CONFLICT(publication_id) DO UPDATE SET enabled=$2,updated_at=now()',[id,enabled]);}
 /** Adapter MUST recheck Publications.get current rights/availability for every opted-in ID in this same transaction. */
 async discovery(c:PoolClient,approved:(c:PoolClient,ids:string[])=>Promise<DiscoveryItem[]>):Promise<DiscoveryEnvelope>{
  const ids=(await c.query('SELECT publication_id FROM federation_listings WHERE enabled ORDER BY publication_id LIMIT $1',[MAX_ITEMS])).rows.map(r=>String(r.publication_id));const items=await approved(c,ids);
  if(items.some(i=>!ids.includes(i.publicationId)))throw deny('FEDERATION_NOT_OPTED_IN');
  const row=(await c.query('INSERT INTO federation_identity_state(singleton,origin,public_key,sequence) VALUES(true,$1,$2,1) ON CONFLICT(singleton) DO UPDATE SET sequence=federation_identity_state.sequence+1 WHERE federation_identity_state.origin=$1 AND federation_identity_state.public_key=$2 RETURNING sequence',[this.origin,this.publicKey])).rows[0];if(!row)throw deny('FEDERATION_IDENTITY_CHANGED');
  const now=Date.now(),payload:DiscoveryPayload={version:1,origin:this.origin,publicKey:this.publicKey,sequence:Number(row.sequence),issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+TTL).toISOString(),items};const text=JSON.stringify(payload),envelope={payload:text,signature:sign(null,Buffer.from(text),this.key).toString('hex')};validateDiscovery(envelope,this.origin,this.publicKey,now);return envelope;
 }
 async peer(c:PoolClient,origin:string,key:string,state:'trusted'|'blocked'){
  federationOrigin(origin);publicKey(key);if(origin===this.origin||!['trusted','blocked'].includes(state))throw deny('FEDERATION_FORMAT');
  await c.query('SELECT pg_advisory_xact_lock(82102)');if(Number((await c.query('SELECT count(*) FROM federation_peers')).rows[0].count)>=MAX_PEERS&&!(await c.query('SELECT 1 FROM federation_peers WHERE origin=$1',[origin])).rowCount)throw deny('FEDERATION_QUOTA');
  const old=(await c.query('SELECT public_key FROM federation_peers WHERE origin=$1',[origin])).rows[0];if(old&&old.public_key!==key)throw deny('FEDERATION_IDENTITY_CHANGED');
  await c.query('INSERT INTO federation_peers(origin,public_key,state) VALUES($1,$2,$3) ON CONFLICT(origin) DO UPDATE SET state=$3,updated_at=now()',[origin,key,state]);if(state==='blocked')await c.query('DELETE FROM federation_cache WHERE origin=$1',[origin]);
 }
 async sync(origin:string,transport:typeof fetchDiscovery=fetchDiscovery):Promise<{state:'synced'|'offline';items:number}>{
  federationOrigin(origin);const lease=randomUUID();const peer=await transaction(this.pool,async c=>{
   const p=(await c.query('SELECT * FROM federation_peers WHERE origin=$1 FOR UPDATE',[origin])).rows[0];if(!p||p.state!=='trusted')throw new ApiError(403,'FEDERATION_BLOCKED');if(p.last_attempt&&Date.now()-new Date(p.last_attempt).getTime()<60_000)throw new ApiError(429,'FEDERATION_RATE');await c.query('UPDATE federation_peers SET last_attempt=now(),lease_id=$2 WHERE origin=$1',[origin,lease]);return p;
  });
  try{const snapshot=validateDiscovery(await transport(origin),origin,peer.public_key);return await transaction(this.pool,async c=>{
   const p=(await c.query('SELECT * FROM federation_peers WHERE origin=$1 FOR UPDATE',[origin])).rows[0];if(!p||p.state!=='trusted'||p.lease_id!==lease||p.public_key!==snapshot.publicKey)throw new ApiError(403,'FEDERATION_BLOCKED');if(snapshot.sequence<=Number(p.sequence))throw deny('FEDERATION_REPLAY');
   await c.query('DELETE FROM federation_cache WHERE origin=$1',[origin]);for(const item of snapshot.items)await c.query('INSERT INTO federation_cache(origin,publication_id,title,url,revision_sha256,published_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[origin,item.publicationId,item.title,item.url,item.revisionSha256,item.publishedAt,snapshot.expiresAt]);await c.query('UPDATE federation_peers SET sequence=$2,last_success=now(),error_code=NULL,lease_id=NULL WHERE origin=$1',[origin,snapshot.sequence]);return {state:'synced' as const,items:snapshot.items.length};
  });}catch(error){await transaction(this.pool,async c=>{await c.query('UPDATE federation_peers SET error_code=$3,lease_id=NULL WHERE origin=$1 AND lease_id=$2',[origin,lease,error instanceof ApiError?error.code:'FEDERATION_NETWORK']);});if(error instanceof ApiError&&error.code!=='FEDERATION_NETWORK')throw error;return {state:'offline',items:0};}
 }
 async directory(c:PoolClient){return {items:(await c.query("SELECT x.origin,x.publication_id,x.title,x.url,x.revision_sha256,x.published_at,p.last_success,(x.expires_at<=now()) AS stale FROM federation_cache x JOIN federation_peers p USING(origin) WHERE p.state='trusted' ORDER BY x.origin,x.publication_id LIMIT $1",[MAX_PEERS*MAX_ITEMS])).rows};}
}
