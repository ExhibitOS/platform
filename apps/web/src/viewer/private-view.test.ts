// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {safePrivateView,savePrivateView,takePrivateView} from './private-view';
import {discardPrivateView} from './private-view-storage';

const id='11111111-1111-4111-8111-111111111111',pub='22222222-2222-4222-8222-222222222222',hash='a'.repeat(64),index='b'.repeat(64);
const doc={rooms:[{id,dimensions:{width:4,height:3,depth:4},transform:{position:[10,0,0],rotation:[0,0,0,1],scale:[1,1,1]}}]} as unknown as Exhibition;
const view={roomId:id,position:[10,1.6,0],target:[10,1.6,-1],fov:48};
afterEach(()=>vi.unstubAllGlobals());
it('checks world position against transformed room and finite camera bounds',()=>{
 expect(safePrivateView(doc,view)).toEqual(view);
 expect(safePrivateView(doc,{...view,position:[0,1.6,0]})).toBeUndefined();
 expect(safePrivateView(doc,{...view,roomId:'missing'})).toBeUndefined();
 expect(safePrivateView(doc,{...view,target:view.position})).toBeUndefined();
 expect(safePrivateView(doc,{...view,fov:NaN})).toBeUndefined();
});
it('consumes only the matching publication, revision and index in this tab',()=>{
 const data=new Map<string,string>();vi.stubGlobal('sessionStorage',{setItem:(k:string,v:string)=>data.set(k,v),getItem:(k:string)=>data.get(k)??null,removeItem:(k:string)=>data.delete(k)});
 savePrivateView(pub,hash,index,view as never);
 expect(takePrivateView(pub,'c'.repeat(64),index,doc)).toBeUndefined();
 expect(takePrivateView(pub,hash,index,doc)).toEqual(view);
 expect(takePrivateView(pub,hash,index,doc)).toBeUndefined();
});

it('discards only the matching abandoned handoff without changing another source',()=>{
 const data=new Map<string,string>();vi.stubGlobal('sessionStorage',{setItem:(k:string,v:string)=>data.set(k,v),getItem:(k:string)=>data.get(k)??null,removeItem:(k:string)=>data.delete(k)});
 savePrivateView(pub,hash,index,view as never);savePrivateView(pub,hash,'c'.repeat(64),view as never);
 discardPrivateView(pub,hash,index);expect(takePrivateView(pub,hash,index,doc)).toBeUndefined();expect(takePrivateView(pub,hash,'c'.repeat(64),doc)).toEqual(view);
});
