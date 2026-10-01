import { Cms, type ArtworkMetadata } from './cms.ts';
import { Imports, MAX_UPLOAD, type ImportInput } from './imports.ts';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { Auth, ApiError, config, uuid, roles, subjectInput, passwordInput, type AuthConfig, type Session, type Role } from './auth.ts';
import type { Pool, PoolClient } from 'pg';
export function registerAuth(app:FastifyInstance,pool:Pool,input:AuthConfig,store?:import('@exhibitos/storage').BlobStore) {
 const settings=config(input), auth=new Auth(pool);
 const token=(req:FastifyRequest) => {
  const cookies=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(`${settings.cookieName}=`));
  return cookies.length===1 ? cookies[0]!.slice(settings.cookieName.length+1) : undefined;
 };
 const cookie=(value:string,clear=false)=>`${settings.cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear?0:28800}${settings.secure?'; Secure':''}`;
 const guarded=(req:FastifyRequest,mutate:boolean)=>{
  if(req.headers.host!==settings.host) throw new ApiError(403,'ORIGIN_REJECTED');
  if(req.headers.origin!==undefined && req.headers.origin!==settings.origin) throw new ApiError(403,'ORIGIN_REJECTED');
  if(mutate && req.headers.origin!==settings.origin) throw new ApiError(403,'ORIGIN_REJECTED');
  if(mutate && req.method!=='POST' && req.method!=='PUT' && req.method!=='PATCH') throw new ApiError(400,'INVALID_INPUT');
 };
 app.setErrorHandler((error,request,reply)=>{
  const framework=error as {validation?:unknown;statusCode?:number};
  const status=error instanceof ApiError ? error.status : framework.validation || framework.statusCode===400 ? 400 : framework.statusCode===413 ? 413 : framework.statusCode===415 ? 415 : 500;
  const code=error instanceof ApiError ? error.code : status===400?'INVALID_INPUT':status===413?'BODY_TOO_LARGE':status===415?'UNSUPPORTED_MEDIA_TYPE':'INTERNAL_ERROR';
  return reply.code(status).send({code,message:code,fieldErrors:[],requestId:request.id});
 });
 const str={type:'string'}, id={type:'string',format:'uuid'};
 const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
 const bodyMetadata=object({revision:{type:'integer',minimum:1},metadata:{type:'object',maxProperties:200}});
 app.post('/api/v1/auth/login',{schema:{body:object({subject:{...str,minLength:3,maxLength:128},password:{...str,minLength:12,maxLength:1024},tenantId:id})}},async(req,reply)=>{
  guarded(req,true);
  const body=req.body as {subject:string;password:string;tenantId:string};
  const result=await auth.login(body.subject,body.password,body.tenantId,req.ip);
  return reply.header('set-cookie',cookie(result.token)).header('cache-control','no-store').send({authenticated:true});
 });
 const call=(mutate:boolean,work:(client:PoolClient,s:Session,req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>)=>async(req:FastifyRequest,reply:FastifyReply)=>{
  guarded(req,mutate);
  reply.header('cache-control','no-store');
  const params=req.params as {tenantId?:string};
  if(params.tenantId) uuid(params.tenantId);
  return auth.request(token(req),params.tenantId,typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:undefined,mutate,(client,s)=>work(client,s,req,reply));
 };
 app.get('/api/v1/auth/session',call(false,async(_c,s)=>s));
 app.post('/api/v1/auth/logout',call(true,async(client,s,_req,reply)=>{
  await client.query('UPDATE auth_sessions SET revoked=true WHERE id=$1',[s.id]);
  reply.header('set-cookie',cookie('',true)); return {loggedOut:true};
 }));
 const prefix='/api/v1/tenants/:tenantId';

 const cms=new Cms(store),cp=`${prefix}/cms`;
 const artistBody={name:{...str,minLength:1,maxLength:512},bio:{...str,maxLength:16384}};
 const fields={title:{...str,minLength:1,maxLength:512},description:{...str,maxLength:16384},dimensions:object({width:{type:'number',exclusiveMinimum:0,maximum:1000000},height:{type:'number',exclusiveMinimum:0,maximum:1000000},depth:{type:'number',exclusiveMinimum:0,maximum:1000000},unit:{const:'m'}}),rights:{type:'object'},provenance:object({source:{enum:['human-authored','ai-assisted','ai-generated']},sourceUnits:{enum:['m','cm','mm']},scaleApplied:{type:'boolean'},notes:{...str,maxLength:4096}})};
 const cmsId=(req:FastifyRequest)=>{const p=req.params as {id:string};uuid(p.id);return p.id;};
 app.post(`${cp}/artists`,{schema:{body:object({...artistBody,userId:{anyOf:[id,{type:'null'}]}},['name','bio'])}},call(true,async(c,s,req,reply)=>{reply.code(201);return cms.createArtist(c,s,req.body as {name:string;bio:string;userId?:string|null});}));
 app.get(`${cp}/artists`,{schema:{querystring:object({limit:{...str,pattern:'^[0-9]{1,2}$'},cursor:id,q:{...str,maxLength:100},archived:{enum:['true','false']}},[])}},call(false,async(c,s,req)=>cms.list(c,s,'artists',req.query as Record<string,string>)));
 app.get(`${cp}/artists/:id`,call(false,async(c,s,req)=>cms.artistView(await cms.artist(c,s,cmsId(req),true))));
 app.patch(`${cp}/artists/:id`,{schema:{body:object({...artistBody,revision:{type:'integer',minimum:1}})}},call(true,async(c,s,req)=>cms.reviseArtist(c,s,cmsId(req),req.body as {name:string;bio:string;revision:number})));
 app.post(`${cp}/artworks`,{schema:{body:object({...fields,artistId:id})}},call(true,async(c,s,req,reply)=>{reply.code(201);return cms.createArtwork(c,s,req.body as ArtworkMetadata&{artistId:string});}));
 app.get(`${cp}/artworks`,{schema:{querystring:object({limit:{...str,pattern:'^[0-9]{1,2}$'},cursor:id,q:{...str,maxLength:100},archived:{enum:['true','false']}},[])}},call(false,async(c,s,req)=>cms.list(c,s,'artworks',req.query as Record<string,string>)));
 app.get(`${cp}/artworks/:id`,call(false,async(c,s,req)=>cms.detail(c,s,cmsId(req),true)));
 app.patch(`${cp}/artworks/:id`,{schema:{body:object({...fields,revision:{type:'integer',minimum:1}})}},call(true,async(c,s,req)=>cms.revise(c,s,cmsId(req),req.body as ArtworkMetadata&{revision:number})));
 for(const kind of ['artists','artworks'] as const){
  app.get(`${cp}/${kind}/:id/revisions`,call(false,async(c,s,req)=>cms.revisions(c,s,cmsId(req),kind)));
  for(const action of ['archive','restore'] as const)app.post(`${cp}/${kind}/:id/${action}`,{schema:{body:object({revision:{type:'integer',minimum:1}})}},call(true,async(c,s,req)=>cms.archive(c,s,kind,cmsId(req),action==='restore',(req.body as {revision:number}).revision)));
 }
 app.post(`${cp}/artworks/:id/approve`,{schema:{body:object({revision:{type:'integer',minimum:1},assetId:id})}},call(true,async(c,s,req)=>cms.approve(c,s,cmsId(req),req.body as {revision:number;assetId:string})));
 app.get(`${cp}/artworks/:id/display`,call(false,async(c,s,req)=>cms.display(c,s,cmsId(req))));
 app.get(`${cp}/artworks/:id/preview`,call(false,async(c,s,req,reply)=>{const result=await cms.display(c,s,cmsId(req),true) as {bytes:Buffer;mime:string};reply.header('content-type',result.mime).header('x-content-type-options','nosniff').header('content-disposition','inline').header('x-exhibitos-watermarked','true');return result.bytes;}));
 const imports=store?new Imports(pool,store):undefined;
 const importer=()=>{if(!imports)throw new ApiError(503,'STORAGE_UNAVAILABLE');return imports;};
 app.addContentTypeParser('application/octet-stream',{parseAs:'buffer',bodyLimit:MAX_UPLOAD},(_req,body,done)=>done(null,body));
 app.post(`${prefix}/imports`,{schema:{body:object({artworkId:id,idempotencyKey:{...str,minLength:1,maxLength:128},mime:{enum:['model/gltf-binary','image/png']},sha256:{...str,pattern:'^[0-9a-f]{64}$'},bytes:{type:'integer',minimum:1,maximum:MAX_UPLOAD},scaleMeters:{type:'number',exclusiveMinimum:0,maximum:1000000},rights:{type:'object'}})}},call(true,async(c,s,req,reply)=>{reply.code(201);return importer().create(c,s,req.body as ImportInput);}));
 app.get(`${prefix}/imports/:id`,call(false,async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);return importer().view(await importer().access(c,s,p.id));}));
 app.put(`${prefix}/imports/:id/bytes`,{bodyLimit:MAX_UPLOAD},call(true,async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);if(req.headers['content-type']!=='application/octet-stream'||!Buffer.isBuffer(req.body))throw new ApiError(415,'UNSUPPORTED_MEDIA_TYPE');return importer().upload(c,s,p.id,req.body);}));
 app.post(`${prefix}/imports/:id/complete`,call(true,async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);return importer().complete(c,s,p.id);}));
 for(const action of ['cancel','retry'] as const)app.post(`${prefix}/imports/:id/${action}`,call(true,async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);return importer().action(c,s,p.id,action);}));

 for(const kind of ['artworks','exhibitions'] as const) {
  app.get(`${prefix}/${kind}/:id`,call(false,async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);return auth.resource(c,s,kind,p.id);}));
  app.patch(`${prefix}/${kind}/:id`,{schema:{body:bodyMetadata}},call(true,async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);const b=req.body as {revision:number;metadata:Record<string,unknown>};return auth.resource(c,s,kind,p.id,b.revision,b.metadata);}));
 }
 app.get(`${prefix}/assets/:id`,call(false,async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);return auth.asset(c,s,p.id);}));
 app.get(`${prefix}/assets/:id/bytes`,call(false,async(c,s,req,reply)=>{const p=req.params as {id:string};uuid(p.id);await auth.asset(c,s,p.id,'download');if(!store) throw new ApiError(503,'STORAGE_UNAVAILABLE');const bytes=await auth.bytes(c,s,p.id,store);reply.header('content-type','application/octet-stream').header('content-disposition','attachment').header('x-content-type-options','nosniff');return bytes;}));
 app.post(`${prefix}/assets/:id/export-check`,call(true,async(c,s,req)=>{const p=req.params as {id:string};uuid(p.id);return auth.asset(c,s,p.id,'export');}));
 app.put(`${prefix}/memberships/:userId`,{schema:{body:object({role:{enum:roles}})}},call(true,async(c,s,req)=>{
  await auth.admin(c,s);const p=req.params as {userId:string};uuid(p.userId);const b=req.body as {role:string};
  const member=await c.query('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2',[s.tenantId,p.userId]);
  if(!member.rowCount) throw new ApiError(403,'FORBIDDEN');
  if(member.rows[0].role==='admin' && b.role!=='admin') {
   const count=await c.query("SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.role='admin' AND NOT u.disabled AND m.user_id<>$2",[s.tenantId,p.userId]);
   if(!count.rowCount) throw new ApiError(409,'LAST_ADMIN');
  }
  await c.query('UPDATE memberships SET role=$3 WHERE tenant_id=$1 AND user_id=$2',[s.tenantId,p.userId,b.role]);
  await c.query('UPDATE auth_sessions SET revoked=true WHERE tenant_id=$1 AND user_id=$2',[s.tenantId,p.userId]);
  await auth.audit(c,s,'membership.changed',p.userId);return {updated:true};
 }));
 app.put(`${prefix}/exhibitions/:id/assignments/:userId`,{schema:{body:object({canView:{type:'boolean'}})}},call(true,async(c,s,req)=>{
  await auth.admin(c,s);const p=req.params as {id:string;userId:string};uuid(p.id);uuid(p.userId);
  await auth.resource(c,s,'exhibitions',p.id);
  const member=await c.query('SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2',[s.tenantId,p.userId]);if(!member.rowCount) throw new ApiError(403,'FORBIDDEN');
  await c.query('INSERT INTO exhibition_assignments VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,exhibition_id,user_id) DO UPDATE SET can_view=excluded.can_view',[s.tenantId,p.id,p.userId,(req.body as {canView:boolean}).canView]);
  await auth.audit(c,s,'assignment.changed',p.userId);return {updated:true};
 }));
 app.post(`${prefix}/exhibitions/:id/assignments/:userId/revoke`,call(true,async(c,s,req)=>{
  await auth.admin(c,s);const p=req.params as {id:string;userId:string};uuid(p.id);uuid(p.userId);await auth.resource(c,s,'exhibitions',p.id);
  await c.query('DELETE FROM exhibition_assignments WHERE tenant_id=$1 AND exhibition_id=$2 AND user_id=$3',[s.tenantId,p.id,p.userId]);
  await auth.audit(c,s,'assignment.revoked',p.userId);return {revoked:true};
 }));
 app.post(`${prefix}/sessions/:id/revoke`,call(true,async(c,s,req)=>{
  await auth.admin(c,s);const p=req.params as {id:string};uuid(p.id);
  const result=await c.query('UPDATE auth_sessions SET revoked=true WHERE tenant_id=$1 AND id=$2 RETURNING id',[s.tenantId,p.id]);if(!result.rowCount) throw new ApiError(403,'FORBIDDEN');
  await auth.audit(c,s,'session.revoked',p.id);return {revoked:true};
 }));
 app.post(`${prefix}/users/:userId/disable`,call(true,async(c,s,req)=>{
  await auth.admin(c,s);const p=req.params as {userId:string};uuid(p.userId);
  // Users can belong to multiple institutions: tenant admin cannot disable globally.
  const member=await c.query('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2',[s.tenantId,p.userId]);if(!member.rowCount) throw new ApiError(403,'FORBIDDEN');
  const other=await c.query('SELECT 1 FROM memberships WHERE user_id=$1 AND tenant_id<>$2',[p.userId,s.tenantId]);if(other.rowCount) throw new ApiError(409,'MULTI_TENANT_USER');
  if(member.rows[0].role==='admin') {const others=await c.query("SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id<>$2 AND m.role='admin' AND NOT u.disabled",[s.tenantId,p.userId]);if(!others.rowCount) throw new ApiError(409,'LAST_ADMIN');}
  await c.query('UPDATE users SET disabled=true WHERE id=$1',[p.userId]);await c.query('UPDATE auth_sessions SET revoked=true WHERE user_id=$1',[p.userId]);await auth.audit(c,s,'user.disabled',p.userId);return {disabled:true};
 }));
 app.post(`${prefix}/users`,{schema:{body:object({subject:{...str,minLength:3,maxLength:128},password:{...str,minLength:12,maxLength:1024},role:{enum:roles}})}},async(req,reply)=>{
  // Check admin before a costly hash; recheck atomically before adding account.
  guarded(req,true);const p=req.params as {tenantId:string};uuid(p.tenantId);const b=req.body as {subject:string;password:string;role:Role};subjectInput(b.subject);passwordInput(b.password);
  const csrf=typeof req.headers['x-csrf-token']==='string'?req.headers['x-csrf-token']:undefined;
  await auth.request(token(req),p.tenantId,csrf,true,(c,s)=>auth.admin(c,s));
  const salt=randomBytes(16), hash=await auth.hash(b.password,salt);
  return auth.request(token(req),p.tenantId,csrf,true,async(c,s)=>{
   await auth.admin(c,s);const userId=randomUUID();
   const exists=await c.query('SELECT 1 FROM users WHERE subject=$1',[b.subject]);if(exists.rowCount) throw new ApiError(409,'SUBJECT_CONFLICT');
   await c.query('INSERT INTO users(id,subject) VALUES($1,$2)',[userId,b.subject]);await c.query('INSERT INTO memberships VALUES($1,$2,$3)',[s.tenantId,userId,b.role]);await c.query("INSERT INTO auth_credentials VALUES($1,$2,$3,'argon2id',19456,2,1)",[userId,salt,hash]);await auth.audit(c,s,'user.created',userId);
   reply.header('cache-control','no-store').code(201);return {userId};
  });
 });
 return settings;
}
