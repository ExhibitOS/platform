// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {encodeDiskReservationReceipt,type DiskReservationReceipt} from './publication-disk-budget.ts';
import {sendOexReservationReceipt} from './oex-reservation-wire.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const receipt:DiskReservationReceipt={version:1,id:id(1),generation:id(2),operation:'oex-import',owner:{databaseSystemId:'1',databaseOid:'2',storeRoot:'/synthetic/store',storeDevice:'3',storeInode:'4'},plan:[{root:'/synthetic/stage',device:'3',bytes:1024}]};
const bytes=encodeDiskReservationReceipt(receipt),digest=createHash('sha256').update(bytes).digest('hex');
function fixture(request:object={version:1,kind:'read-receipt',correlationId:id(4),attemptId:id(3),offset:0,length:bytes.length}){
 return {send:vi.fn(async(_payload:Uint8Array)=>{}),receive:vi.fn(async()=>Buffer.from(JSON.stringify(request))),close:vi.fn(async()=>{})};
}
it('sends the exact portable provider receipt with the challenged digest',async()=>{
 const c=fixture();await sendOexReservationReceipt(c,receipt,id(5),id(3),digest);
 const ready=JSON.parse(Buffer.from(c.send.mock.calls[0]![0]).toString()),chunk=JSON.parse(Buffer.from(c.send.mock.calls[1]![0]).toString());
 expect(ready).toEqual({version:1,kind:'receipt-ready',correlationId:id(5),attemptId:id(3),bytes:bytes.length,sha256:digest});expect(Buffer.from(chunk.data,'base64')).toEqual(bytes);expect(c.close).not.toHaveBeenCalled();
});
it('closes without disclosing receipt bytes on bad digest or out-of-order request',async()=>{
 const a=fixture();await expect(sendOexReservationReceipt(a,receipt,id(5),id(3),'0'.repeat(64))).rejects.toThrow('OEX_RESERVATION_WIRE');expect(a.send).not.toHaveBeenCalled();expect(a.close).toHaveBeenCalledOnce();
 const b=fixture({version:1,kind:'read-receipt',correlationId:id(4),attemptId:id(3),offset:1,length:bytes.length});await expect(sendOexReservationReceipt(b,receipt,id(5),id(3),digest)).rejects.toThrow('OEX_RESERVATION_WIRE');expect(b.send).toHaveBeenCalledOnce();expect(b.close).toHaveBeenCalledOnce();
});
