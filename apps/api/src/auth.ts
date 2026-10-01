import { allowedRights } from './rights.ts';
import { argon2, randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { transaction, membership, artworkAccess, exhibitionAccess, AccessDenied } from '@exhibitos/storage';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const roles = ['admin','artist','curator','viewer'] as const;
export type Role = typeof roles[number];
export class ApiError extends Error { readonly status:number; readonly code:string; constructor(status:number,code:string) {super(code);this.status=status;this.code=code;} }
export interface AuthConfig { mode: 'local'|'network'; origin: string; bindHost: string; }
export function config(input: AuthConfig) {
 const origin = new URL(input.origin);
 if (origin.origin !== input.origin || origin.username || origin.password) throw Error('AUTH_ORIGIN must be an exact origin');
 if (input.mode !== 'local' && input.mode !== 'network') throw Error('invalid AUTH_MODE');
 if (!['127.0.0.1','::1'].includes(input.bindHost)) throw Error('auth HTTP listener must bind loopback behind TLS terminator');
 if (input.mode === 'network' && origin.protocol !== 'https:') throw Error('network auth requires HTTPS');
 if (input.mode === 'local' && (!['127.0.0.1','::1'].includes(input.bindHost) || !['127.0.0.1','[::1]'].includes(origin.hostname))) throw Error('local auth requires loopback bind/origin');
 if (!['http:','https:'].includes(origin.protocol)) throw Error('invalid auth protocol');
 return { ...input, host: origin.host, secure: origin.protocol === 'https:', cookieName: origin.protocol === 'https:' ? '__Host-exhibitos_session' : 'exhibitos_local_session' };
}
export const kdf = (password: string, salt: Buffer) => new Promise<Buffer>((resolve,reject) => {
 argon2('argon2id', {message:password,nonce:salt,memory:19456,passes:2,parallelism:1,tagLength:32}, (error,key) => error ? reject(error) : resolve(key));
});
export function passwordInput(password: unknown): asserts password is string {
 if (typeof password !== 'string' || Buffer.byteLength(password) < 12 || Buffer.byteLength(password) > 1024) throw new ApiError(400,'INVALID_INPUT');
}
export function subjectInput(subject: unknown): asserts subject is string {
 if (typeof subject !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.@-]{2,127}$/.test(subject)) throw new ApiError(400,'INVALID_INPUT');
}
export function uuid(value: unknown): asserts value is string {
 if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ApiError(400,'INVALID_INPUT');
}
// Lock order: auth82003 then maintenance82002; a backup holds only82002.
export async function bootstrap(pool: Pool, tenantId: string, subject: string, password: string) {
 uuid(tenantId); subjectInput(subject); passwordInput(password);
 const salt = randomBytes(16), key = await kdf(password,salt);
 return transaction(pool, async client => {
  await client.query('SELECT pg_advisory_xact_lock(82003)');
  await client.query('SELECT pg_advisory_xact_lock_shared(82002)');
  const previous = await client.query('SELECT 1 FROM auth_credentials LIMIT 1');
  if (previous.rowCount) throw new ApiError(409,'BOOTSTRAP_CLOSED');
  const userId = randomUUID();
  await client.query("INSERT INTO tenants(id,name) VALUES($1,'Local institution') ON CONFLICT(id) DO NOTHING",[tenantId]);
  await client.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,subject]);
  await client.query("INSERT INTO memberships VALUES($1,$2,'admin')",[tenantId,userId]);
  await client.query("INSERT INTO auth_credentials VALUES($1,$2,$3,'argon2id',19456,2,1)",[userId,salt,key]);
  return {userId,tenantId};
 });
}
export interface Session { id:string; userId:string; tenantId:string; role:Role; csrfToken:string; expiresAt:string; }
export class Auth {
 private runningKdf = 0;
 private attempts = new Map<string,{count:number; until:number}>();
 readonly pool:Pool;
 constructor(pool:Pool) {this.pool=pool;}
 async hash(password:string,salt:Buffer) {
  if(this.runningKdf>=4) throw new ApiError(429,'RATE_LIMITED');
  this.runningKdf++;try{return await kdf(password,salt);}finally{this.runningKdf--;}
 }
 async login(subject: string, password: string, tenantId: string, address: string) {
  subjectInput(subject); passwordInput(password); uuid(tenantId);
  const now = Date.now();
  for (const [key,value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
  const rate = this.attempts.get(address) ?? {count:0,until:now+60000};
  if (rate.count >= 10 || this.runningKdf >= 4 || (!this.attempts.has(address) && this.attempts.size >= 4096)) throw new ApiError(429,'RATE_LIMITED');
  rate.count++; this.attempts.set(address,rate); this.runningKdf++;
  try {
   const result = await this.pool.query('SELECT c.*,u.id FROM users u JOIN auth_credentials c ON c.user_id=u.id WHERE u.subject=$1',[subject]);
   const row = result.rows[0];
   const key = await kdf(password,row?.salt ?? Buffer.alloc(16));
   const valid = !!row && timingSafeEqual(key,row.password_hash);
   return await transaction(this.pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(82003)');
  await client.query('SELECT pg_advisory_xact_lock_shared(82002)');
    const active = valid ? await client.query('SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id WHERE u.id=$1 AND m.tenant_id=$2 AND NOT u.disabled AND t.deleted_at IS NULL',[row.id,tenantId]) : null;
    if (!active?.rowCount) throw new ApiError(401,'AUTH_REQUIRED');
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url'), id = randomUUID();
    await client.query("INSERT INTO auth_sessions(id,token_hash,csrf_hash,csrf_token,tenant_id,user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '8 hours')",[id,digest(token),digest(csrf),csrf,tenantId,row.id]);
    return {token};
   });
  } finally { this.runningKdf--; }
 }
 async request<T>(token: string|undefined, tenantId: string|undefined, csrf: string|undefined, mutate: boolean, work: (client:PoolClient,session:Session)=>Promise<T>) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401,'AUTH_REQUIRED');
  return transaction(this.pool, async client => {
   await client.query(`SELECT pg_advisory_xact_lock${mutate ? '' : '_shared'}(82003)`);
   if(mutate) await client.query('SELECT pg_advisory_xact_lock_shared(82002)');
   const result = await client.query('SELECT s.*,m.role FROM auth_sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON (m.tenant_id,m.user_id)=(s.tenant_id,s.user_id) JOIN tenants t ON t.id=s.tenant_id WHERE s.token_hash=$1 AND NOT s.revoked AND s.expires_at>now() AND NOT u.disabled AND t.deleted_at IS NULL',[digest(token)]);
   const row = result.rows[0]; if (!row) throw new ApiError(401,'AUTH_REQUIRED');
   if (tenantId && tenantId !== row.tenant_id) throw new ApiError(403,'FORBIDDEN');
   if (mutate && (!csrf || !timingSafeEqual(Buffer.from(digest(csrf)),Buffer.from(row.csrf_hash)))) throw new ApiError(403,'CSRF_REJECTED');
   const session:Session={id:row.id,userId:row.user_id,tenantId:row.tenant_id,role:row.role,csrfToken:row.csrf_token,expiresAt:row.expires_at.toISOString()};
   try { return await work(client,session); } catch(error) { if (error instanceof AccessDenied) throw new ApiError(403,'FORBIDDEN'); throw error; }
  });
 }
 async resource(client:PoolClient,s:Session,kind:'artworks'|'exhibitions',id:string,revision?:number,metadata?:Record<string,unknown>) {
  const actor={tenantId:s.tenantId,userId:s.userId};
  const row = kind==='artworks' ? await artworkAccess(client,actor,id,revision!==undefined) : await exhibitionAccess(client,actor,id,revision!==undefined);
  if(kind==='artworks'&&row.cms_managed){if(revision!==undefined)throw new ApiError(400,'CMS_ROUTE_REQUIRED');if(s.role!=='admin'&&(s.role!=='artist'||row.owner_user_id!==s.userId))throw new ApiError(403,'FORBIDDEN');}
  if (revision === undefined) return {id:row.id,tenantId:row.tenant_id,revision:row.revision,metadata:row.metadata};
  await client.query('SELECT pg_advisory_xact_lock_shared(82002)');
  const updated = await client.query(`UPDATE ${kind} SET metadata=$4,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND revision=$3 RETURNING revision`,[s.tenantId,id,revision,metadata]);
  if (!updated.rowCount) throw new ApiError(409,'REVISION_CONFLICT');
  const entity=kind==='artworks'?'artwork':'exhibition';
  await client.query(`INSERT INTO ${entity}_revisions(tenant_id,${entity}_id,revision,snapshot) VALUES($1,$2,$3,$4)`,[s.tenantId,id,updated.rows[0].revision,metadata]);
  return {id,revision:updated.rows[0].revision};
 }
 async asset(client:PoolClient,s:Session,id:string,permission: false|'export'|'download'=false) {
  const role=await membership(client,{tenantId:s.tenantId,userId:s.userId});
  if (!['admin','artist'].includes(role)) throw new AccessDenied();
  const result=await client.query('SELECT a.id,a.artwork_id,a.sha256,a.bytes,a.mime,a.state,a.object_key,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.id=$2 AND a.deleted_at IS NULL AND r.deleted_at IS NULL',[s.tenantId,id]);
  const row=result.rows[0]; if (!row) throw new AccessDenied();
  const artwork=await artworkAccess(client,{tenantId:s.tenantId,userId:s.userId},row.artwork_id);
  if (permission) {
   if (!allowedRights(row.rights,permission)||(artwork.cms_managed||artwork.metadata?.rights!==undefined)&&!allowedRights(artwork.metadata?.rights,permission)) throw new ApiError(403,'RIGHTS_DENIED');
   return {authorized:true,assetId:id,scope:'authorization-only',packageProduced:false};
  }
  return {id:row.id,artworkId:row.artwork_id,sha256:row.sha256,bytes:Number(row.bytes),mime:row.mime,state:row.state};
 }
 async bytes(client:PoolClient,s:Session,id:string,store:import('@exhibitos/storage').BlobStore) {
  await client.query('SELECT pg_advisory_xact_lock_shared(82002)');
  await this.asset(client,s,id,'download');
  const result=await client.query('SELECT object_key,sha256,bytes,state FROM assets WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL',[s.tenantId,id]);
  const row=result.rows[0];if(!['stored','approved'].includes(row.state)) throw new ApiError(409,'ASSET_NOT_STORED');
  const bytes=Buffer.from(await store.get(row.object_key));
  if(bytes.length!==Number(row.bytes)||createHash('sha256').update(bytes).digest('hex')!==row.sha256) throw new ApiError(409,'ASSET_INTEGRITY');
  return bytes;
 }
 async admin(client:PoolClient,s:Session) { if(s.role!=='admin') throw new ApiError(403,'FORBIDDEN'); await membership(client,{tenantId:s.tenantId,userId:s.userId},true); }
 async audit(client:PoolClient,s:Session,action:string,target:string) {
  await client.query('INSERT INTO audit_events(tenant_id,id,metadata) VALUES($1,$2,$3)',[s.tenantId,randomUUID(),{action,actor:s.userId,target}]);
 }
}
