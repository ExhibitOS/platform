// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID,createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {newDraft} from '../../web/src/drafts/example.ts';
import {etag} from './studio.ts';
const control=vi.hoisted(()=>({cpu:undefined as undefined|(()=>Promise<null>)}));
vi.mock('./viewer-budget-inspection.ts',async importOriginal=>{
 const actual=await importOriginal<typeof import('./viewer-budget-inspection.ts')>();
 return {...actual,inspectViewerBudget:(...args:Parameters<typeof actual.inspectViewerBudget>)=>actual.inspectViewerBudget(args[0],args[1],args[2],async()=>control.cpu!())};
});
import {buildApp} from './app.ts';
it('commits auth locks before pending analysis while Save, settings and unrelated authenticated reads complete',async()=>{
 const tenantId=randomUUID(),userId=randomUUID(),csrf='csrf',token='a'.repeat(43),draft=newDraft(),row={id:draft.exhibitionId,revision:2,metadata:draft,studio_owner_user_id:userId};
 const session={id:randomUUID(),tenant_id:tenantId,user_id:userId,role:'artist',csrf_token:csrf,csrf_hash:createHash('sha256').update(csrf).digest('hex'),expires_at:new Date('2099-01-01T00:00:00Z')};
 let readers=0,writer=false,notify:()=>void=()=>{};
 const waiting=new Set<()=>void>();notify=()=>{for(const wake of waiting)wake();waiting.clear();};
 const pool={connect:async()=>{
  let lock:'read'|'write'|null=null;
  return {release:()=>{},query:async(sql:string,args:unknown[]=[])=>{
   if(sql.includes('pg_advisory_xact_lock')&&sql.includes('82003')){
    const write=!sql.includes('_shared');while(writer||write&&readers>0)await new Promise<void>(resolve=>waiting.add(resolve));
    lock=write?'write':'read';if(write)writer=true;else readers++;
   }
   if(sql==='COMMIT'||sql==='ROLLBACK'){if(lock==='write')writer=false;if(lock==='read')readers--;lock=null;notify();}
   if(sql.includes('SELECT s.*,m.role'))return {rows:[session],rowCount:1};
   if(sql.startsWith('SELECT id,revision,metadata,studio_owner_user_id'))return {rows:[row],rowCount:1};
   if(sql.startsWith('UPDATE exhibitions SET metadata')){row.metadata=args[2] as typeof draft;row.revision=args[3] as number;}
   return {rows:[],rowCount:0};
  }};
 }} as unknown as Pool;
 let release!:()=>void,entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),paused=new Promise<void>(resolve=>release=resolve);
 control.cpu=async()=>{expect(writer).toBe(false);expect(readers).toBe(0);entered();await paused;return null;};
 const origin='http://127.0.0.1:13200',app=buildApp({pool,auth:{mode:'local',origin,bindHost:'127.0.0.1'}}),headers={host:'127.0.0.1:13200',origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf},url=`/api/v1/tenants/${tenantId}/studio/exhibitions/${row.id}`,head=etag(2,draft);
 const analysis=app.inject({method:'POST',url:url+'/viewer-budget-analysis',headers:{...headers,'if-match':head},payload:{requestId:randomUUID(),expectedRevision:2,draft,options:{profile:'standard'}}}).then(response=>response);
 try{
  await started;
  const ordinary=structuredClone(draft);ordinary.editVersion++;
  const save=await app.inject({method:'PUT',url,headers:{...headers,'if-match':head},payload:{requestId:randomUUID(),draft:ordinary}});expect(save.statusCode,save.body).toBe(200);
  const settings=await app.inject({method:'PUT',url:url+'/viewer-budget',headers:{...headers,'if-match':save.json().etag},payload:{requestId:randomUUID(),expectedRevision:3,policy:{version:1,policyVersion:1,profiles:{},targetProfile:'compact'}}});expect(settings.statusCode,settings.body).toBe(200);
  const unrelated=await app.inject({method:'GET',url:'/api/v1/auth/session',headers});expect(unrelated.statusCode,unrelated.body).toBe(200);
  release();const response=await analysis;expect(response.statusCode,response.body).toBe(412);expect(response.json().code).toBe('VIEWER_BUDGET_ANALYSIS_STALE');
 }finally{release();await analysis;await app.close();control.cpu=undefined;}
});
