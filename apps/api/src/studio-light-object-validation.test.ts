// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {expect,it,vi} from 'vitest';
import {validateLifecycle} from '@exhibitos/spec';
import {applyFurnishingCommand,FURNISHING_NAMESPACE,type StudioFurnishings} from '@exhibitos/studio-contract';
import {newDraft} from '../../web/src/drafts/example.ts';
import {newLight} from '../../web/src/placement/model.ts';
import {Studio} from './studio.ts';
import type {Session} from './auth.ts';

function fixture(){
 const draft=newDraft(),light=newLight(draft.candidate.rooms[0]!.id,'spot');light.transform.position=[0,2,0];draft.candidate.lights.push(light);
 draft.candidate=applyFurnishingCommand(draft.candidate,{type:'set-furnishing-visual',hostKind:'light',hostId:light.id,catalogId:'museum-track-spot',catalogVersion:1,pose:{position:[0,.15,.0755],yaw:0,scale:1}});
 const inventory=draft.candidate.extensions![FURNISHING_NAMESPACE] as unknown as StudioFurnishings;
 // Structurally valid OES inventory is not authority to replace a known model.
 inventory.assets[0]!.sha256='1'.repeat(64);inventory.assets[0]!.provenance={sourceSha256:'1'.repeat(64),recipe:'original-v1'};
 expect(validateLifecycle(draft).valid).toBe(true);
 const session={role:'admin',tenantId:randomUUID(),userId:randomUUID()} as Session;
 return {draft,session};
}
it('rejects a forged catalogue model before an ordinary draft create writes anything',async()=>{
 const {draft,session}=fixture(),query=vi.fn();
 await expect(new Studio().create({query} as unknown as PoolClient,session,{draft,requestId:randomUUID()})).rejects.toMatchObject({status:422});
 expect(query).not.toHaveBeenCalled();
});
it('does not reopen a persisted structurally valid but forged fixture model as an admitted draft',async()=>{
 const {draft,session}=fixture(),query=vi.fn().mockResolvedValue({rows:[{id:draft.exhibitionId,revision:1,metadata:draft,studio_owner_user_id:session.userId}],rowCount:1});
 await expect(new Studio().get({query} as unknown as PoolClient,session,draft.exhibitionId)).rejects.toMatchObject({status:409,code:'DRAFT_CORRUPT'});
});
