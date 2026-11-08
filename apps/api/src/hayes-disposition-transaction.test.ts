// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {Auth} from './auth.ts';
import {commitHayesDisposition} from './hayes-disposition-transaction.ts';

it('cannot enter the draft transaction without an admitted native ready issuer',async()=>{
 const receipt=await readFile(new URL('./test-fixtures/hayes-committed-receipt.synthetic.json',import.meta.url));
 const vector=JSON.parse(receipt.toString()),connect=vi.fn();
 const input={admission:{},auth:new Auth({connect} as unknown as Pool),owner:{},blobs:{getBounded:async()=>Buffer.alloc(0)},binding:vector.binding,receiptBytes:receipt} as unknown as Parameters<typeof commitHayesDisposition>[0];
 await expect(commitHayesDisposition(input)).rejects.toThrow('HAYES_READY_NOT_ADMITTED');
 expect(connect).not.toHaveBeenCalled();
});
