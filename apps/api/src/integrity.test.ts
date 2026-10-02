// SPDX-License-Identifier: AGPL-3.0-or-later
import {it,expect} from 'vitest';
import type {PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import {Integrities} from './integrity.ts';
it('denies non-admin before acquiring maintenance lock or enumerating objects',async()=>{
 const client={query:()=>{throw Error('must not query');}}as unknown as PoolClient;
 const store={list:()=>{throw Error('must not enumerate');}}as unknown as BlobStore;
 await expect(new Integrities(store,{migrationDirectory:'/unused'}).inspect(client,{role:'artist'}as Session)).rejects.toMatchObject({status:403,code:'FORBIDDEN'});
});
