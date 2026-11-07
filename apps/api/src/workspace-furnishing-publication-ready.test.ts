// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {ApiError} from './auth.ts';
import {Publications,finalizePublicationOperation} from './publication.ts';
import {etag} from './studio.ts';

it('only admits the selected 038 owner source and requires export permission',async()=>{
 const candidate=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition,room=candidate.rooms[0]!,id=crypto.randomUUID(),descriptor={id,version:1,kind:'pedestal',name:'Synthetic',rights:{holder:'Synthetic',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Synthetic private note',model:{mime:'model/gltf-binary',bytes:28,sha256:'a'.repeat(64)}};
 candidate.extensions={...candidate.extensions,'org.exhibitos.studio/workspace-furnishings':{version:1,furnishings:[descriptor],placements:[{id:crypto.randomUUID(),roomId:room.id,furnishingId:id,furnishingVersion:1,position:[0,0,0],yaw:0,scale:1}]}} as never;
 const model=vi.fn().mockResolvedValue({bytes:Buffer.alloc(28)}),service={matchesBinding:()=>true,readVersion:vi.fn().mockResolvedValue(descriptor),model},owner={workspaceFurnishingPublication:true},publisher=new Publications({} as Pool,{} as never,undefined,service as never,owner as never),prepare=publisher as unknown as {prepare:(c:PoolClient,s:Session,e:Exhibition,id:string)=>Promise<{issues:{code:string}[]}>};
 const result=await prepare.prepare({} as PoolClient,{} as Session,candidate,candidate.id);expect(result.issues.some(issue=>issue.code==='WORKSPACE_FURNISHING_PUBLICATION_UNSUPPORTED')).toBe(false);expect(model).toHaveBeenCalledWith(expect.anything(),expect.anything(),id,1,'export');
 model.mockRejectedValueOnce(new ApiError(403,'RIGHTS_DENIED'));const denied=await prepare.prepare({} as PoolClient,{} as Session,candidate,candidate.id);expect(denied.issues.some(issue=>issue.code==='RIGHTS_DENIED')).toBe(true);
 const old=new Publications({} as Pool,{} as never,undefined,service as never,{} as never) as unknown as typeof prepare;expect((await old.prepare({} as PoolClient,{} as Session,candidate,candidate.id)).issues.some(issue=>issue.code==='WORKSPACE_FURNISHING_PUBLICATION_UNSUPPORTED')).toBe(true);
});

it('rejects an unstaged workspace publication before any object write',async()=>{
 const candidate=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;candidate.extensions={...candidate.extensions,'org.exhibitos.studio/workspace-furnishings':{version:1,furnishings:[],placements:[]}} as never;
 const publisher=new Publications({} as Pool),metadata={kind:'exhibition-draft',candidate},row={metadata,revision:1};vi.spyOn(publisher.studio,'access').mockResolvedValue(row as never);const query=vi.fn().mockResolvedValue({rows:[],rowCount:0}),c={query} as unknown as PoolClient,s={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()} as Session;
 await expect(publisher.publish(c,s,candidate.id,crypto.randomUUID(),etag(row.revision,row.metadata as never))).rejects.toMatchObject({code:'PUBLICATION_STAGE_UNAVAILABLE'});expect(query.mock.calls.every(([sql])=>String(sql).startsWith('SELECT'))).toBe(true);
});
it('runs the final rights gate after the last asynchronous source recheck',async()=>{
 let now=1000;const expiresAt=2000,order:string[]=[],verify=vi.fn(async()=>{order.push('verify');}),recheck=vi.fn(async()=>{order.push('source');now=expiresAt;}),gate=vi.fn(async()=>{order.push('gate');if(now>=expiresAt)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');return true;}),claimed=vi.fn(()=>{order.push('claimed');});
 await expect(finalizePublicationOperation(verify,recheck,gate,claimed)).rejects.toMatchObject({code:'PUBLICATION_UNAVAILABLE'});expect(order).toEqual(['verify','source','gate']);expect(claimed).not.toHaveBeenCalled();
});
