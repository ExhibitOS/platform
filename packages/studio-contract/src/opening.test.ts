// SPDX-License-Identifier: AGPL-3.0-or-later
import {it,expect} from 'vitest';
import {validateOpeningClientMessage,validateOpeningServerMessage} from './opening.ts';
const id='10000000-0000-4000-8000-000000000001',rev='a'.repeat(64);
it('rejects submitted host/identity, arbitrary guide pose, open signal objects and malformed bounded payloads',()=>{
 const join={version:1,type:'join',publicationId:id,revisionSha256:rev};expect(validateOpeningClientMessage(join)).toBe(true);
 for(const v of [{...join,host:true},{...join,userId:id},{...join,resumeToken:'x'.repeat(43),hostGrant:'y'.repeat(43)},{version:1,type:'host',command:'guide',viewpointId:'v',position:[0,0,0]},{version:1,type:'signal',targetId:id,description:{type:'offer',sdp:'x',url:'https://x'}},{version:1,type:'signal',targetId:id,description:{type:'offer',sdp:'x'},candidate:{candidate:'',sdpMid:null,sdpMLineIndex:null}},{version:1,type:'signal',targetId:id,candidate:{candidate:'x',sdpMid:null,sdpMLineIndex:Number.POSITIVE_INFINITY}},{version:1,type:'chat',text:'x'.repeat(241)},{version:1,type:'chat',text:'\u0000'}])expect(validateOpeningClientMessage(v)).toBe(false);
 expect(validateOpeningClientMessage({version:1,type:'signal',targetId:id,candidate:{candidate:'',sdpMid:null,sdpMLineIndex:null}})).toBe(true);
});
it('snapshots cannot leak guest reports, resume secrets, multiple hosts, excessive voice or unrecognized guides',()=>{
 const participant={id,name:'Visitor A12345',host:false,chat:false,voice:false,follow:false,muted:false,connected:true};const snap={version:1,type:'snapshot',publicationId:id,revisionSha256:rev,selfId:id,serverTime:1,sequence:1,phase:'waiting',participants:[participant],guide:null,messages:[],reports:[],blockedIds:[]};const validate=(v:unknown)=>validateOpeningServerMessage(v,id,rev,new Set(['v']));expect(validate(snap)).toBe(true);
 expect(validate({...snap,resumeToken:'x'.repeat(43)})).toBe(false);expect(validate({...snap,guide:{id:'unknown',sequence:1,kind:'guide'}})).toBe(false);expect(validate({...snap,reports:[{id,reporterId:id,targetId:id,reason:'spam',note:'',at:1}]})).toBe(false);expect(validate({...snap,blockedIds:[id,id]})).toBe(false);expect(validate({...snap,participants:[participant,{...participant,id:'10000000-0000-4000-8000-000000000002',host:true},{...participant,id:'10000000-0000-4000-8000-000000000003',host:true}]})).toBe(false);
});
