// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {assertWorkspaceFurnishingSnapshot} from './workspace-furnishing-snapshot.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const rights={holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:true,export:true,commercial:true}},item={id:id(2),version:1,kind:'pedestal',name:'Synthetic',rights,provenance:'Synthetic',model:{mime:'model/gltf-binary',bytes:1,sha256:'a'.repeat(64)}},placement={id:id(3),roomId:id(1),furnishingId:id(2),furnishingVersion:1,position:[1,0,0],yaw:0,scale:1},candidate={rooms:[{id:id(1),dimensions:{width:10,depth:10,height:4}}],extensions:{'org.exhibitos.studio/workspace-furnishings':{version:1,furnishings:[item],placements:[placement]}}},client={} as PoolClient,session={} as Session;
it('requires owner-issued catalog equality and live display rights before persisting furnishing references',async()=>{
 const service={readVersion:vi.fn(async()=>structuredClone(item))};await expect(assertWorkspaceFurnishingSnapshot(client,session,candidate)).rejects.toMatchObject({code:'WORKSPACE_FURNISHING_UNAVAILABLE'});await expect(assertWorkspaceFurnishingSnapshot(client,session,candidate,service as never)).resolves.toBeUndefined();expect(service.readVersion).toHaveBeenCalledWith(client,session,item.id,1);
 const altered=structuredClone(candidate);altered.extensions['org.exhibitos.studio/workspace-furnishings'].furnishings[0]!.model.sha256='b'.repeat(64);await expect(assertWorkspaceFurnishingSnapshot(client,session,altered,service as never)).rejects.toMatchObject({code:'FURNISHING_VERSION_MISMATCH'});
 const denied=structuredClone(candidate);denied.extensions['org.exhibitos.studio/workspace-furnishings'].furnishings[0]!.rights.permissions.display=false;service.readVersion.mockResolvedValueOnce(denied.extensions['org.exhibitos.studio/workspace-furnishings'].furnishings[0]!);await expect(assertWorkspaceFurnishingSnapshot(client,session,denied,service as never)).rejects.toMatchObject({code:'DISPLAY_PERMISSION_REQUIRED'});
});
