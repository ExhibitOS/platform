// SPDX-License-Identifier: AGPL-3.0-or-later
import { FREEZE_VERSION, MAX_FREEZE_BYTES, MAX_RUNTIME_BYTES, MAX_OFFLINE_SECONDS, freezeCanonical, freezeFileMime, type FreezeBundle, type FreezeManifest, type OfflineGrant } from './freeze.js';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hex = /^[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
 if (!object(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value,key))) throw Error('FREEZE_INVALID');
}
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function timestamp(value: unknown): value is string { return text(value,32) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)); }
function identity(value: unknown): value is string { return typeof value === 'string' && uuid.test(value); }
function sha(value: unknown): value is string { return typeof value === 'string' && hex.test(value); }
function origin(value: unknown): value is string {
 if (!text(value,512)) return false;
 try { const parsed=new URL(value); return parsed.origin === value && !parsed.username && !parsed.password && (parsed.protocol === 'https:' || parsed.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)); } catch { return false; }
}
export function validateFreezeManifest(value: unknown): asserts value is FreezeManifest {
 exact(value,['schemaVersion','kind','id','createdAt','source','formats','oex','runtime','authority']);
 if (value.schemaVersion !== FREEZE_VERSION || value.kind !== 'exhibition-freeze') throw Error('FREEZE_VERSION_UNSUPPORTED');
 if (!identity(value.id) || !timestamp(value.createdAt)) throw Error('FREEZE_INVALID');
 exact(value.source,['exhibitionId','revision','etag','exhibitionHash']);
 if (!identity(value.source.exhibitionId) || !Number.isSafeInteger(value.source.revision) || (value.source.revision as number)<1 || (value.source.revision as number)>2147483647 || !text(value.source.etag,128) || !/^"studio-r[1-9][0-9]*-[a-f0-9]{64}"$/.test(value.source.etag) || !sha(value.source.exhibitionHash)) throw Error('FREEZE_INVALID');
 exact(value.formats,['oes','oex','specPackage','specSha256','migrations']);
 if (value.formats.oes !== '1.0.0-draft.1' || value.formats.oex !== '1.0.0-draft.2' || value.formats.specPackage !== '0.1.0-draft.2' || value.formats.specSha256 !== '164525a8cbcf4f81dbf16d119fdf37f614aaaa9bbc9c362f2723348753bea154') throw Error('FREEZE_FORMAT_UNSUPPORTED');
 const migrations=value.formats.migrations;
 if (!Array.isArray(migrations) || migrations.length<1 || migrations.length>64 || migrations.some(x=>typeof x!=='string'||!/^\d{3}_[a-z0-9_-]+\.sql:[a-f0-9]{64}$/.test(x)) || new Set(migrations.map(x=>(x as string).split(':')[0])).size!==migrations.length) throw Error('FREEZE_INVALID');
 exact(value.oex,['bytes','sha256']);
 if (!Number.isSafeInteger(value.oex.bytes) || (value.oex.bytes as number)<1 || (value.oex.bytes as number)>64*1024*1024 || !sha(value.oex.sha256)) throw Error('FREEZE_LIMIT');
 exact(value.runtime,['version','coreDigest','imageDigest','files']);
 if (!text(value.runtime.version,64) || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/.test(value.runtime.version) || !sha(value.runtime.coreDigest) || !sha(value.runtime.imageDigest) || !Array.isArray(value.runtime.files) || value.runtime.files.length<6 || value.runtime.files.length>256) throw Error('FREEZE_RUNTIME_INVALID');
 let total=0; const paths=new Set<string>();
 for (const file of value.runtime.files) {
  exact(file,['path','bytes','sha256','mime']);
  if (!text(file.path,240) || paths.has(file.path) || typeof file.mime!=='string' || freezeFileMime(file.path)===null || freezeFileMime(file.path)!==file.mime || !Number.isSafeInteger(file.bytes) || (file.bytes as number)<1 || (file.bytes as number)>MAX_RUNTIME_BYTES || !sha(file.sha256)) throw Error('FREEZE_RUNTIME_INVALID');
  paths.add(file.path); total+=file.bytes as number;
 }
 if (total>MAX_RUNTIME_BYTES || ['index.html','THIRD_PARTY_NOTICES.txt','freeze-runtime.json','studio-sw.js','offline-server.mjs'].some(path=>!paths.has(path)) || ![...paths].some(path=>/^assets\/.*\.js$/.test(path))) throw Error('FREEZE_RUNTIME_INVALID');
 if (value.runtime.files.map(file=>(file as {path:string}).path).join('\n')!==[...paths].sort().join('\n')) throw Error('FREEZE_RUNTIME_INVALID');
 exact(value.authority,['origin','keyId','publicKey']);
 if (!origin(value.authority.origin) || !sha(value.authority.keyId) || !text(value.authority.publicKey,2048)) throw Error('FREEZE_AUTHORITY_INVALID');
 if (freezeCanonical(value).length>256*1024) throw Error('FREEZE_LIMIT');
}
export function validateOfflineGrant(value: unknown): asserts value is OfflineGrant {
 exact(value,['schemaVersion','kind','freezeId','manifestSha256','tenantId','subjectId','origin','keyId','issuedAt','expiresAt']);
 if (value.schemaVersion!==FREEZE_VERSION || value.kind!=='offline-display-grant' || !identity(value.freezeId) || !sha(value.manifestSha256) || !identity(value.tenantId) || !identity(value.subjectId) || !origin(value.origin) || !sha(value.keyId) || !timestamp(value.issuedAt) || !timestamp(value.expiresAt)) throw Error('OFFLINE_GRANT_INVALID');
 const duration=Date.parse(value.expiresAt)-Date.parse(value.issuedAt);
 if (duration<=0 || duration>MAX_OFFLINE_SECONDS*1000) throw Error('OFFLINE_GRANT_INVALID');
}
export function freezeBase64(bytes: Uint8Array): string {
 let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value);
}
export function freezeUnbase64(value: unknown, expected?: number, max=MAX_RUNTIME_BYTES): Uint8Array {
 if (typeof value!=='string' || value.length>Math.ceil(max/3)*4 || value.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || expected!==undefined && value.length!==Math.ceil(expected/3)*4) throw Error('FREEZE_ENCODING_INVALID');
 let raw:string;try {raw=atob(value);}catch{throw Error('FREEZE_ENCODING_INVALID');}
 if (raw.length>max || expected!==undefined && raw.length!==expected) throw Error('FREEZE_ENCODING_INVALID');
 const bytes=Uint8Array.from(raw,x=>x.charCodeAt(0));
 if (freezeBase64(bytes)!==value) throw Error('FREEZE_ENCODING_INVALID');
 return bytes;
}
export async function freezeSha256(value: Uint8Array | string): Promise<string> {
 const bytes=typeof value==='string'?new TextEncoder().encode(value):Uint8Array.from(value);
 const hash=await crypto.subtle.digest('SHA-256',bytes.buffer);return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
}
export interface VerifiedFreeze { bundle: FreezeBundle; oexBytes: Uint8Array; runtimeFiles: Map<string,Uint8Array> }
/** A key contained in an untrusted file never establishes its own trust. */
export async function verifyFreezeBundle(raw: Uint8Array, options: {trustedKeys: readonly string[]; now?:number; preservationOnly?:boolean}): Promise<VerifiedFreeze> {
 if (raw.byteLength<1 || raw.byteLength>MAX_FREEZE_BYTES) throw Error('FREEZE_LIMIT');
 let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw Error('FREEZE_INVALID');}
 exact(value,['schemaVersion','kind','manifest','signature','authorization','oex','runtimeFiles']);
 if(value.schemaVersion!==FREEZE_VERSION||value.kind!=='exhibitos-offline')throw Error('FREEZE_VERSION_UNSUPPORTED');
 validateFreezeManifest(value.manifest);const manifest=value.manifest;
 if (!options.trustedKeys.includes(manifest.authority.keyId)) throw Error('FREEZE_AUTHORITY_UNTRUSTED');
 const publicBytes=freezeUnbase64(manifest.authority.publicKey,44,2048);
 if(await freezeSha256(publicBytes)!==manifest.authority.keyId)throw Error('FREEZE_AUTHORITY_INVALID');
 let key:CryptoKey;try{key=await crypto.subtle.importKey('spki',publicBytes.buffer as ArrayBuffer,{name:'Ed25519'},false,['verify']);}catch{throw Error('FREEZE_AUTHORITY_INVALID');}
 const verify=async(signature:unknown,data:unknown)=>crypto.subtle.verify({name:'Ed25519'},key,freezeUnbase64(signature,64,64).buffer as ArrayBuffer,new TextEncoder().encode(freezeCanonical(data)).buffer);
 if(!await verify(value.signature,manifest))throw Error('FREEZE_SIGNATURE_INVALID');
 const manifestHash=await freezeSha256(freezeCanonical(manifest));
 exact(value.authorization,['grant','signature']);validateOfflineGrant(value.authorization.grant);
 const grant=value.authorization.grant;
 if(grant.freezeId!==manifest.id||grant.manifestSha256!==manifestHash||grant.origin!==manifest.authority.origin||grant.keyId!==manifest.authority.keyId||Date.parse(grant.issuedAt)<Date.parse(manifest.createdAt)||!await verify(value.authorization.signature,grant))throw Error('OFFLINE_GRANT_INVALID');
 const now=options.now??Date.now();
 if(!Number.isFinite(now))throw Error('OFFLINE_CLOCK_INVALID');
 if(!options.preservationOnly && (now<Date.parse(grant.issuedAt)||now>=Date.parse(grant.expiresAt)))throw Error(now<Date.parse(grant.issuedAt)?'OFFLINE_CLOCK_ROLLBACK':'OFFLINE_GRANT_EXPIRED');
 if(await freezeSha256(freezeCanonical(manifest.runtime.files))!==manifest.runtime.imageDigest)throw Error('FREEZE_RUNTIME_INTEGRITY');
 if(!Array.isArray(value.runtimeFiles)||value.runtimeFiles.length!==manifest.runtime.files.length)throw Error('FREEZE_RUNTIME_INTEGRITY');
 const runtimeFiles=new Map<string,Uint8Array>();
 for(const file of value.runtimeFiles){exact(file,['path','data']);if(typeof file.path!=='string'||runtimeFiles.has(file.path))throw Error('FREEZE_RUNTIME_INTEGRITY');const descriptor=manifest.runtime.files.find(x=>x.path===file.path);if(!descriptor)throw Error('FREEZE_RUNTIME_INTEGRITY');const bytes=freezeUnbase64(file.data,descriptor.bytes);if(await freezeSha256(bytes)!==descriptor.sha256)throw Error('FREEZE_RUNTIME_INTEGRITY');runtimeFiles.set(file.path,bytes);}
 const oexBytes=freezeUnbase64(value.oex,manifest.oex.bytes,64*1024*1024);
 if(await freezeSha256(oexBytes)!==manifest.oex.sha256)throw Error('FREEZE_OEX_INTEGRITY');
 return {bundle:value as unknown as FreezeBundle,oexBytes,runtimeFiles};
}
