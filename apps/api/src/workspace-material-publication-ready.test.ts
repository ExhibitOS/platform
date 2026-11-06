// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {Publications} from './publication.ts';

it('reports a workspace material as blocked in readiness before projection',async()=>{
 const candidate=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;
 candidate.extensions={...candidate.extensions,'org.exhibitos.studio/workspace-materials':{version:1,materials:[],bindings:[]}} as never;
 const publisher=new Publications({} as Pool),metadata={kind:'exhibition-draft',candidate};vi.spyOn(publisher.studio,'access').mockResolvedValue({metadata,revision:1} as never);
 const result=await publisher.ready({} as PoolClient,{} as Session,candidate.id);
 expect(result.status).toBe('BLOCKED');expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'WORKSPACE_MATERIAL_PUBLICATION_UNSUPPORTED'})]));
});
