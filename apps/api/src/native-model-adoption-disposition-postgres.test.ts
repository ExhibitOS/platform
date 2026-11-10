// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {migrate} from '@exhibitos/storage';
import {expect,it} from 'vitest';
import {Auth,bootstrap} from './auth.ts';
import {Studio,etag,insertStudioReceipt} from './studio.ts';
import {newDraft} from '../../web/src/drafts/example.ts';
import {syntheticArtwork} from '../../web/src/placement/model.ts';
import {modelReceiptDigest} from './model-preparation-intent.ts';
import {nativeModelAdoptionRightsPolicyDigest} from './native-model-adoption-grant.ts';
import {lockNativeModelAdoptionOperation} from './native-model-adoption-disposition.ts';
import {runNativeModelAdoptionOwner} from './native-model-adoption-owner.ts';

// Explicitly provisioned, disposable PostgreSQL only. No official workspace is used.
const url=process.env.EXHIBITOS_ADOPTION_TEST_DATABASE_URL;
it.skipIf(!url)('serializes competing owner wire operations on real Auth and PostgreSQL locks',async()=>{
 const applicationName=`adoption-race-${randomUUID()}`;
 const pool=new Pool({connectionString:url,application_name:applicationName,max:5,statement_timeout:10000});
 try{
  // Refuse an existing database before any product migration or fixture write.
  expect((await pool.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")).rows[0].count).toBe('0');
  await migrate(pool,new URL('../../../database/migrations/',import.meta.url).pathname);
  const tenantId=randomUUID(),subject=`race-${randomUUID()}`,password='Synthetic-adoption-only-password';
  const {userId}=await bootstrap(pool,tenantId,subject,password),auth=new Auth(pool),studio=new Studio();
  const sessions=await Promise.all([auth.login(subject,password,tenantId,'first'),auth.login(subject,password,tenantId,'second')]);
  const owners=await Promise.all(sessions.map(async({token})=>auth.request(token,tenantId,undefined,false,async(_c,s)=>({
   workspaceId:randomUUID(),tenantId,principalId:userId,sessionToken:token,csrfToken:s.csrfToken,
  }))));
  for(const first of ['cancel','commit'] as const){
   const draft=newDraft('Synthetic operation disposition race'),owner=owners[0]!,secondOwner={...owners[1]!,workspaceId:owner.workspaceId};
   const saved=await auth.requestForNativeWorkspaceMutation(owner.sessionToken,tenantId,owner.csrfToken,(c,s)=>studio.create(c,s,{requestId:randomUUID(),draft}));
   const prior=syntheticArtwork('sculpture'),placementId=randomUUID();
   const rights={holder:'Synthetic Institution',ownership:'owner' as const,licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Synthetic fixture'};
   prior.rights=rights;
   const previewDraft=structuredClone(draft);
   Object.assign(previewDraft.candidate,{artworks:[prior],placements:[{id:placementId,artworkRevisionId:prior.revisionId,assetId:prior.primaryAssetId}]});
   const now=Date.now(),operationId=randomUUID();
   const grant={version:1 as const,operationId,issuedAt:now,expiresAt:now+60000,
    source:{workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),artworkId:randomUUID(),artworkRevision:1,artworkRevisionId:randomUUID()},
    target:{workspaceId:owner.workspaceId,tenantId,principalId:userId,artworkId:prior.id,artworkRevision:prior.revision,exhibitionId:draft.exhibitionId,placementId,etag:etag(1,previewDraft)},
    receiptSha256:'a'.repeat(64),rightsSha256:modelReceiptDigest(rights),rightsPolicySha256:nativeModelAdoptionRightsPolicyDigest(rights),sourceCreditLine:rights.creditLine,
    original:{sha256:'b'.repeat(64),bytes:64},display:{sha256:'c'.repeat(64),bytes:32},
   },grantSha256=modelReceiptDigest(grant);
   let release!:()=>void,held!:()=>void;
   const gate=new Promise<void>(resolve=>{release=resolve;}),holding=new Promise<void>(resolve=>{held=resolve;});
   const noWrites=new Proxy({}, {get(){throw Error('UNEXPECTED_BROKER_OR_BLOB_ACCESS');}});
   const cms={ownArtwork:async()=>({revision:prior.revision,approved_revision:prior.revision,metadata:{title:'Synthetic',description:'',dimensions:{width:1,height:1,unit:'m'},rights,provenance:{source:'synthetic',sourceUnits:'m',scaleApplied:true,notes:''}}}),studioArtwork:async()=>({artwork:prior})};
   const commitStudio={access:async()=>({revision:1,metadata:previewDraft,studio_owner_user_id:userId})};
   const run=async(kind:'cancel'|'commit',selected:typeof owner,hold:boolean)=>{
    const controller=new AbortController(),runtimeGeneration=randomUUID(),responses:Record<string,unknown>[]=[];
    const frames=kind==='cancel'?[{version:1,kind:'adoption-dispose-target',operationId,runtimeGeneration,grantSha256,exhibitionId:draft.exhibitionId}]:[
     {version:1,kind:'adoption-preview-target',operationId,runtimeGeneration,grant},
     {version:1,kind:'adoption-commit-target',operationId,runtimeGeneration,grantSha256,grant},
    ];
    let requests=0;
    const adapter={requestForNativeWorkspaceMutation:(token:string,tenant:string,csrf:string,work:Parameters<Auth['requestForNativeWorkspaceMutation']>[3])=>
     auth.requestForNativeWorkspaceMutation(token,tenant,csrf,async(c,s)=>{
      // Create the committed fixture inside the winning transaction, so the
      // waiting disposition must see it through a fresh post-lock snapshot.
      if(hold&&kind==='commit'&&requests===1){
       await lockNativeModelAdoptionOperation(c,s,operationId);
       await insertStudioReceipt(c,[tenantId,s.userId,operationId,modelReceiptDigest(['native-model-adoption-v1',grantSha256]),draft.exhibitionId,saved]);
      }
      const response=await work(c,s);
      requests++;
      if(hold&&requests===(kind==='cancel'?1:2)){held();await gate;}
      return response;
     })};
    await runNativeModelAdoptionOwner({owner:selected,runtimeGeneration,targetOnly:true,signal:controller.signal,
     channel:{receive:async()=>Buffer.from(JSON.stringify(frames.shift())),send:async bytes=>{responses.push(JSON.parse(Buffer.from(bytes).toString()));if(!frames.length)controller.abort();},close:async()=>{},isOpen:()=>true},
     auth:adapter as Auth,studio:(kind==='cancel'?studio:commitStudio) as Studio,cms:cms as never,
     imports:{requiredModelReady:async()=>{},coarseOwner:async()=>{}} as never,blobs:noWrites as never,broker:noWrites as never,assertLive:async()=>{},
    });
    return responses.at(-1)!;
   };
   const winner=run(first,owner,true);
   await holding;
   const contender=run(first==='cancel'?'commit':'cancel',secondOwner,false);
   let blocked=false;
   try{
    for(let attempt=0;attempt<100;attempt++){
     const waiting=await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[applicationName]);
     if(waiting.rowCount){blocked=true;break;}await delay(10);
    }
    expect(blocked).toBe(true);
   }finally{release();}
   const [a,b]=await Promise.all([winner,contender]);
   if(first==='cancel'){
    expect(a).toMatchObject({kind:'adoption-target-disposition',outcome:'cancelled',revision:null,etag:null});
    expect(b).toMatchObject({kind:'adoption-refused',code:'MODEL_ADOPTION_CANCELLED'});
   }else{
    expect(a).toMatchObject({kind:'adoption-target-committed',revision:saved.revision,etag:saved.etag});
    expect(b).toMatchObject({kind:'adoption-target-disposition',outcome:'committed',revision:saved.revision,etag:saved.etag});
   }
   const receipt=await pool.query('SELECT response FROM studio_requests WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3',[tenantId,userId,operationId]);
   expect(receipt.rowCount).toBe(1);
   expect(receipt.rows[0].response).toEqual(first==='cancel'?{kind:'native-model-adoption-cancelled-v1',grantSha256,exhibitionId:draft.exhibitionId}:saved);
  }
 }finally{await pool.end();}
},30000);
