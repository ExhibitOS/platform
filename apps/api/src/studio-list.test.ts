// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { Session } from './auth.ts';
import { Studio } from './studio.ts';
const session = {tenantId:'10000000-0000-4000-8000-000000000001',userId:'10000000-0000-4000-8000-000000000002',role:'artist'} as Session;
describe('Studio list query admission', () => {
  it('denies nonauthoring roles and invalid pagination before reading any rows', async () => {
    const query=vi.fn(), c={query} as unknown as PoolClient, studio=new Studio();
    await expect(studio.list(c,{...session,role:'viewer'},{})).rejects.toMatchObject({code:'FORBIDDEN'});
    for(const q of [{limit:'0'},{limit:'51'},{limit:'1.5'},{cursor:'invalid'},{q:'a'.repeat(101)}])
      await expect(studio.list(c,session,q)).rejects.toMatchObject({status:400});
    expect(query).not.toHaveBeenCalled();
  });
  it('keeps search literals in parameters and returns only bounded summaries with a continuation', async () => {
    const rows=[{id:'10000000-0000-4000-8000-000000000010',revision:2,title:'작품 % _',metadata:'private'},{id:'10000000-0000-4000-8000-000000000011',revision:1,title:'Second',owner:'private'}];
    const query=vi.fn().mockResolvedValue({rows}), c={query} as unknown as PoolClient;
    const result=await new Studio().list(c,session,{limit:'1',q:"%_'"});
    expect(result).toEqual({items:[{id:rows[0]!.id,revision:2,title:'작품 % _'}],nextCursor:rows[0]!.id});
    expect(query.mock.calls[0]![1]).toEqual([session.tenantId,false,session.userId,null,"%_'",2]);
    expect(query.mock.calls[0]![0]).not.toContain("%_'");
  });
});
