// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {newDraft} from './drafts/example';
import {checkedBoundedEditing,checkedFrame,geometryProposal,type NativeViewportFrame} from './native-viewport-protocol';

it('limits a server-admitted bounded viewport to one selected placement transform',async()=>{
 const archive=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),draft=newDraft();draft.candidate=archive.exhibition;draft.exhibitionId=draft.candidate.id;
 const image=draft.candidate.artworks.find(a=>a.artworkType==='image')!;
 for(let i=0;i<10;i++){const a=structuredClone(image);a.id=crypto.randomUUID();a.revisionId=crypto.randomUUID();a.assets[0]!.id=crypto.randomUUID();a.primaryAssetId=a.assets[0]!.id;a.assets[0]!.path=`bounded-${i}.png`;a.assets[0]!.bytes=32*1024*1024;draft.candidate.artworks.push(a);}
 const placement=draft.candidate.placements[0]!,workspaceId=crypto.randomUUID(),etag='"studio-r2-'+ 'a'.repeat(64)+'"';
 const frame:NativeViewportFrame={version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),workspaceId,baseETag:etag,draft,selection:{kind:'placement',id:placement.id},mode:'translate',view:'isometric',cameraSequence:0,transparent:false,disabled:false};
 expect(()=>checkedFrame(frame)).toThrow('VIEWPORT_FRAME_INVALID');expect(checkedFrame(frame,undefined,'bounded-file-v1')).toEqual(frame);
 const capability={version:1,kind:'native-bounded-edit-v1',tenantId:frame.tenantId,principalId:frame.principalId,workspaceId,exhibitionId:draft.exhibitionId,revision:2,etag};
 expect(checkedBoundedEditing(capability,frame)).toEqual(capability);expect(()=>checkedBoundedEditing({...capability,etag:'wrong'},frame)).toThrow('VIEWPORT_SCOPE_CHANGED');
 const {id,...other}=placement,position=[...other.transform.position] as [number,number,number];position[0]+=0.01;
 const candidate={...other,transform:{...other.transform,position}};
 expect(()=>geometryProposal(frame,{type:'set-placement',id,placement:candidate})).toThrow();
 const changed=geometryProposal(frame,{type:'set-placement',id,placement:candidate},true);expect(changed.placements.find(p=>p.id===id)?.transform.position).toEqual(position);
 expect(()=>geometryProposal(frame,{type:'add-room',room:draft.candidate.rooms[0]!},true)).toThrow('VIEWPORT_COMMAND_DENIED');
 expect(()=>geometryProposal(frame,{type:'set-placement',id,placement:{...candidate,roomId:crypto.randomUUID()}},true)).toThrow('VIEWPORT_COMMAND_DENIED');
 expect(()=>geometryProposal(frame,{type:'set-placement',id,placement:{...candidate,transform:{...candidate.transform,scale:[0,1,1]}}},true)).toThrow();
});
