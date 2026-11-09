// SPDX-License-Identifier: AGPL-3.0-or-later
// Private, manifest-selected integration probe. It never publishes or approves.
import {fstatSync,readSync,closeSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {Auth} from '../apps/api/dist/auth.js';
import {Cms} from '../apps/api/dist/cms.js';
import {Imports} from '../apps/api/dist/imports.js';
import {startLocalRuntime} from './local-runtime.mjs';
import {readNativeWorkspaceChannel} from './native-workspace-channel.mjs';
import {closeNativeOwnerDescriptor,unpackNativeOwnerInput} from './native-owner-channel.mjs';
const sourceHash='e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6',sourceBytes=8383096,outputHash='694a9cf81dfbf12fd0841ae45240c5ae0f1d7cb129d0ee122be7cff86c4625bc';
const frameKeys=['version','kind','runtimeGeneration','nativeOwnerId','runtimeManifestSha256'];
const log=value=>console.info(JSON.stringify(value));
function closeUnusedSource(){const raw=process.env.EXHIBITOS_TEST_HAYES_SOURCE_FD;if(typeof raw==='string'&&/^[1-9][0-9]{1,3}$/.test(raw)&&![process.env.EXHIBITOS_NATIVE_OWNER_FD,process.env.EXHIBITOS_NATIVE_HAYES_OWNER_FD,process.env.EXHIBITOS_NATIVE_FURNISHING_WRITER_FD].some(fd=>Number(fd)===Number(raw)))closeNativeOwnerDescriptor(raw);}
export function readSource(environment){
 const raw=environment.EXHIBITOS_TEST_HAYES_SOURCE_FD;if(typeof raw!=='string'||!/^[1-9][0-9]{1,3}$/.test(raw))throw Error('HAYES_PROBE_SOURCE');const fd=Number(raw);
 if(!Number.isSafeInteger(fd)||fd>1023||[environment.EXHIBITOS_NATIVE_OWNER_FD,environment.EXHIBITOS_NATIVE_HAYES_OWNER_FD,environment.EXHIBITOS_NATIVE_FURNISHING_WRITER_FD].some(x=>typeof x==='string'&&Number(x)===fd))throw Error('HAYES_PROBE_SOURCE');
 let bytes;try{const before=fstatSync(fd,{bigint:true});if(!before.isFile()||before.size!==BigInt(sourceBytes))throw Error('HAYES_PROBE_SOURCE');bytes=Buffer.alloc(sourceBytes);let offset=0;while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)throw Error('HAYES_PROBE_SOURCE');offset+=n;}const after=fstatSync(fd,{bigint:true});if(before.dev!==after.dev||before.ino!==after.ino||after.size!==before.size||createHash('sha256').update(bytes).digest('hex')!==sourceHash)throw Error('HAYES_PROBE_SOURCE');return bytes;}catch(error){bytes?.fill(0);throw error;}finally{closeSync(fd);}
}
export function metadata(){
 // Exact output accessor bounds; dimensions/height are explicit test display
 // choices, not physical source measurements or official composition.
 const min=[-111.304901123047,-138.046203613281,-66.4871978759766],max=[111.318000793457,138.027603149414,66.5052108764648],height=.4,scale=height/(max[1]-min[1]);
 return {title:'Hayes isolated native probe',description:'Private integration fixture.',dimensions:{width:(max[0]-min[0])*scale,height,depth:(max[2]-min[2])*scale,unit:'m'},rights:{holder:'Smithsonian National Portrait Gallery',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:true,export:true,commercial:true},creditLine:'Smithsonian National Portrait Gallery'},provenance:{source:'synthetic',sourceUnits:'unknown',scaleApplied:false,notes:'Isolated fixture; presentation dimensions are not source measurements.'},displayReference:{version:1,status:'provisional-uncalibrated',assetSha256:outputHash,rawBounds:{min,max},referenceHeightMeters:height,pose:{position:[0,0,0],rotation:[0,0,0,1],scale:[scale,scale,scale]}}};
}
export function parseProbeArm(raw,hayes){
 const text=Buffer.from(raw).toString('utf8'),arm=JSON.parse(text);
 if(JSON.stringify(Object.keys(arm))!==JSON.stringify(frameKeys)||arm.version!==1||arm.kind!=='hayes-session-probe-start'||arm.runtimeGeneration!==hayes.runtimeGeneration||arm.nativeOwnerId!==hayes.nativeOwnerId||arm.runtimeManifestSha256!==hayes.runtimeManifestSha256||JSON.stringify(arm)!==text)throw Error('HAYES_PROBE_ARM');
 return arm;
}
let held;
const probe={
 onProbePhase:(phase,monotonicNs,code)=>log({kind:'hayes-probe-phase',phase,monotonicNs,...(code?{code}:{})}),
 onClaimCommitted:(binding,monotonicNs)=>log({kind:'hayes-probe-claim-committed',attemptId:binding.attemptId,jobId:binding.jobId,correlationId:binding.correlationId,monotonicNs}),
 async run({caller,channel,pool,blobs,owner,workspace,hayes,signal,assertLive}){
  let sourceConsumed=false;try{
  parseProbeArm(await channel.receive(300000),hayes);
  sourceConsumed=true;const original=readSource(process.env),auth=new Auth(pool),credentials={token:workspace.sessionToken,csrf:workspace.csrfToken},cms=new Cms(blobs),imports=new Imports(pool,blobs,owner),tenant=workspace.tenantId;
  try{
   const artwork=await auth.requestForHayesNativeMutation(credentials.token,tenant,credentials.csrf,{signal,deadlineMs:Date.now()+30000},async(c,s)=>{await assertLive();const artist=await cms.createArtist(c,s,{name:'Isolated Hayes probe',bio:'Private integration fixture.'});const result=await cms.createArtwork(c,s,{artistId:artist.id,...metadata()});await assertLive();return result;});
   const created=await caller.create(credentials,{artworkId:artwork.id,artworkRevision:artwork.revision,displayReferenceSha256:outputHash,idempotencyKey:randomUUID()},Date.now()+30000);
   await auth.requestForHayesNativeMutation(credentials.token,tenant,credentials.csrf,{signal,deadlineMs:Date.now()+30000},async(c,s)=>{await assertLive();const result=await imports.upload(c,s,created.id,original);await assertLive();return result;});
   await auth.requestForHayesNativeMutation(credentials.token,tenant,credentials.csrf,{signal,deadlineMs:Date.now()+30000},async(c,s)=>{await assertLive();const result=await imports.complete(c,s,created.id);await assertLive();return result;});
   held=await caller.start(credentials,{jobId:created.id,artworkId:artwork.id,artworkRevision:artwork.revision},Date.now()+180000);
   if(!held)throw Error('HAYES_SESSION_PROBE_UNAVAILABLE');
   log({kind:'hayes-probe-revalidated',jobId:created.id,artworkId:artwork.id,artworkRevision:artwork.revision,monotonicNs:process.hrtime.bigint().toString()});
  }finally{original.fill(0);}
  }finally{if(!sourceConsumed)closeUnusedSource();}
 }
};
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
let runtime,handedOff=false;
try{const received=unpackNativeOwnerInput(await readNativeWorkspaceChannel());handedOff=true;runtime=await startLocalRuntime(process.env,received.workspace,received.ownerChannel,received.hayesOwnerChannel,probe);console.info('ExhibitOS local runtime started.');for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await runtime.close();held=undefined;});}
catch{if(!handedOff){for(const fd of new Set([process.env.EXHIBITOS_NATIVE_OWNER_FD,process.env.EXHIBITOS_NATIVE_HAYES_OWNER_FD,process.env.EXHIBITOS_NATIVE_FURNISHING_WRITER_FD,process.env.EXHIBITOS_TEST_HAYES_SOURCE_FD]))closeNativeOwnerDescriptor(fd);}else if(!runtime&&![process.env.EXHIBITOS_NATIVE_OWNER_FD,process.env.EXHIBITOS_NATIVE_HAYES_OWNER_FD,process.env.EXHIBITOS_NATIVE_FURNISHING_WRITER_FD].some(fd=>Number(fd)===Number(process.env.EXHIBITOS_TEST_HAYES_SOURCE_FD)))closeNativeOwnerDescriptor(process.env.EXHIBITOS_TEST_HAYES_SOURCE_FD);console.error('HAYES_SESSION_PROBE_FAILED');process.exitCode=1;if(runtime)await runtime.close().catch(()=>{});}

}
