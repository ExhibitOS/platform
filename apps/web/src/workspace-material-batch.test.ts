// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {openWorkspaceMaterialBatch,type MaterialBatchRecord} from './workspace-material-batch.mjs';
const revision='a'.repeat(64),id='11111111-1111-4111-8111-111111111111';
const records:MaterialBatchRecord[]=[{materialId:id,version:1,role:'color',sha256:'b'.repeat(64),bytes:3},{materialId:id,version:1,role:'normal',sha256:'c'.repeat(64),bytes:2}];
function response(header:unknown={version:1,records},tail=new Uint8Array([1,2,3,4,5])){const json=new TextEncoder().encode(JSON.stringify(header)),all=new Uint8Array(4+json.length+tail.length);new DataView(all.buffer).setUint32(0,json.length);all.set(json,4);all.set(tail,4+json.length);let offset=0;const stream=new ReadableStream<Uint8Array>({pull(controller){if(offset===all.length){controller.close();return;}const end=Math.min(all.length,offset+7);controller.enqueue(all.slice(offset,end));offset=end;}});return new Response(stream,{headers:{'content-type':'application/vnd.exhibitos.material-maps-v1','x-exhibitos-publication-revision':revision,'x-exhibitos-material-batch':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}});}
it('reads the exact ordered snapshot inventory incrementally and can skip an unused map',async()=>{const batch=await openWorkspaceMaterialBatch(response(),records,revision);expect(await batch.next(records[1]!)).toEqual(new Uint8Array([4,5]));await batch.cancel();});
it('rejects changed inventory, truncated bytes and extra trailing bytes',async()=>{
 await expect(openWorkspaceMaterialBatch(response({version:1,records:[{...records[0],sha256:'0'.repeat(64)},records[1]]}),records,revision)).rejects.toThrow('PUBLICATION_UNAVAILABLE');
 const truncated=await openWorkspaceMaterialBatch(response(undefined,new Uint8Array([1,2])),records,revision);await expect(truncated.next(records[0]!)).rejects.toThrow('PUBLICATION_UNAVAILABLE');
 const extra=await openWorkspaceMaterialBatch(response(undefined,new Uint8Array([1,2,3,4,5,6])),records,revision);await extra.next(records[0]!);await expect(extra.next(records[1]!)).rejects.toThrow('PUBLICATION_UNAVAILABLE');
});
it('cancels a pending read once and rejects concurrent or later reads',async()=>{
 const json=new TextEncoder().encode(JSON.stringify({version:1,records})),head=new Uint8Array(4+json.length);new DataView(head.buffer).setUint32(0,json.length);head.set(json,4);let cancelled=0;const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(head);},cancel(){cancelled++;}});
 const batch=await openWorkspaceMaterialBatch(new Response(stream,{headers:{'content-type':'application/vnd.exhibitos.material-maps-v1','x-exhibitos-publication-revision':revision,'x-exhibitos-material-batch':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}}),records,revision);
 const pending=expect(batch.next(records[0]!)).rejects.toThrow('PUBLICATION_UNAVAILABLE');await expect(batch.next(records[0]!)).rejects.toThrow('PUBLICATION_UNAVAILABLE');await Promise.all([batch.cancel(),batch.cancel()]);await pending;await expect(batch.next(records[0]!)).rejects.toThrow('PUBLICATION_UNAVAILABLE');expect(cancelled).toBe(1);
});
