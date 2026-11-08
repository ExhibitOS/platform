// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {Auth} from './auth.ts';
import {reserveHayesOutput} from './hayes-output-reservation.ts';
import {storeHayesOutput} from './hayes-output-storage.ts';
it('does not reserve, copy or connect without issued ready authority',async()=>{
 const connect=vi.fn(),auth=new Auth({connect} as unknown as Pool),blobs=new FileBlobStore('/unused-hayes-test-root');
 const base={admission:{},auth,owner:{},blobs,token:undefined,csrf:undefined} as unknown as Parameters<typeof reserveHayesOutput>[0];
 await expect(reserveHayesOutput(base)).rejects.toThrow('HAYES_READY_NOT_ADMITTED');
 await expect(storeHayesOutput({...base,blobs,bytes:Buffer.from('test')})).rejects.toThrow('HAYES_READY_NOT_ADMITTED');
 expect(connect).not.toHaveBeenCalled();
});
