// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {assertWorkspaceFurnishingSnapshot} from './workspace-furnishing-snapshot.ts';
import {ApiError} from './auth.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const rights={holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:true,export:true,commercial:true}},item={id:id(2),version:1,kind:'pedestal',name:'Synthetic',rights,provenance:'Synthetic',model:{mime:'model/gltf-binary',bytes:1,sha256:'a'.repeat(64)}},placement={id:id(3),roomId:id(1),furnishingId:id(2),furnishingVersion:1,position:[1,0,0],yaw:0,scale:1},candidate={rooms:[{id:id(1),dimensions:{width:10,depth:10,height:4}}],extensions:{'org.exhibitos.studio/workspace-furnishings':{version:1,furnishings:[item],placements:[placement]}}},client={} as PoolClient,session={} as Session;
it('requires owner-issued catalog equality and live display rights before persisting furnishing references',async()=>{
 const service={readVersion:vi.fn(async()=>structuredClone(item))};await expect(assertWorkspaceFurnishingSnapshot(client,session,candidate)).rejects.toMatchObject({code:'WORKSPACE_FURNISHING_UNAVAILABLE'});await expect(assertWorkspaceFurnishingSnapshot(client,session,candidate,service as never)).resolves.toBeUndefined();expect(service.readVersion).toHaveBeenCalledWith(client,session,item.id,1);
 const altered=structuredClone(candidate);altered.extensions['org.exhibitos.studio/workspace-furnishings'].furnishings[0]!.model.sha256='b'.repeat(64);await expect(assertWorkspaceFurnishingSnapshot(client,session,altered,service as never)).rejects.toMatchObject({code:'FURNISHING_VERSION_MISMATCH'});
 const denied=structuredClone(candidate);denied.extensions['org.exhibitos.studio/workspace-furnishings'].furnishings[0]!.rights.permissions.display=false;service.readVersion.mockResolvedValueOnce(denied.extensions['org.exhibitos.studio/workspace-furnishings'].furnishings[0]!);await expect(assertWorkspaceFurnishingSnapshot(client,session,denied,service as never)).rejects.toMatchObject({code:'DISPLAY_PERMISSION_REQUIRED'});
});

it('requires an explicit stool-capable owner for version 2 snapshots',async()=>{
 const stool={...item,kind:'stool'},v2=structuredClone(candidate);v2.extensions['org.exhibitos.studio/workspace-furnishings']={version:2,furnishings:[stool],placements:[placement]};
 const service={supportsStool:vi.fn(()=>false),readVersion:vi.fn(async()=>structuredClone(stool))};
 await expect(assertWorkspaceFurnishingSnapshot(client,session,v2,service as never)).rejects.toMatchObject({code:'WORKSPACE_FURNISHING_UNAVAILABLE'});
 expect(service.readVersion).not.toHaveBeenCalled();
 service.supportsStool.mockReturnValue(true);
 await expect(assertWorkspaceFurnishingSnapshot(client,session,v2,service as never)).resolves.toBeUndefined();
});

it('rejects even old kinds in a v3 snapshot without the room-visual capability',async()=>{
 const v3=structuredClone(candidate);v3.extensions['org.exhibitos.studio/workspace-furnishings'].version=3;
 const service={supportsRoomVisual:vi.fn(()=>false),readVersion:vi.fn(async()=>structuredClone(item))};await expect(assertWorkspaceFurnishingSnapshot(client,session,v3,service as never)).rejects.toMatchObject({code:'WORKSPACE_FURNISHING_UNAVAILABLE'});expect(service.readVersion).not.toHaveBeenCalled();service.supportsRoomVisual.mockReturnValue(true);await expect(assertWorkspaceFurnishingSnapshot(client,session,v3,service as never)).resolves.toBeUndefined();
});

it('rechecks the frame model and current display grant on each snapshot',async()=>{
 const sha='4b14e45ccf14ed38eea90c50553733a0b97b1671b9ec377d900e5a947545f8b4',frame={...item,kind:'artwork-frame',model:{mime:'model/gltf-binary',bytes:7892,sha256:sha}};
 const doc={rooms:[{id:id(1),dimensions:{width:6,height:3,depth:8},transform:{scale:[1,1,1]}}],artworks:[{id:id(8),revisionId:id(5),primaryAssetId:id(6),schemaVersion:'1.0.0-draft.1',artworkType:'image',dimensions:{width:.6,height:.8},transform:{scale:[1,1,1]}}],placements:[{id:id(4),roomId:id(1),artworkRevisionId:id(5),assetId:id(6),transform:{scale:[1,1,1]}}],extensions:{'org.exhibitos.studio/workspace-furnishings':{version:4,furnishings:[frame],placements:[],frameAttachments:[{placementId:id(4),artworkRevisionId:id(5),assetId:id(6),furnishingId:id(2),furnishingVersion:1,modelSha256:sha}]}}};
 const service={supportsArtworkFrame:vi.fn(()=>true),readVersion:vi.fn(async()=>structuredClone(frame)),checkDisplay:vi.fn(async()=>structuredClone(frame)),checkArtwork:vi.fn(async()=>{})};
 await expect(assertWorkspaceFurnishingSnapshot(client,session,doc,service as never)).resolves.toBeUndefined();expect(service.checkArtwork).toHaveBeenCalledWith(client,session,doc.artworks[0]);expect(service.checkDisplay).toHaveBeenCalledWith(client,session,id(2),1);
 service.checkArtwork.mockRejectedValueOnce(new ApiError(409,'ARTWORK_SNAPSHOT_CHANGED'));await expect(assertWorkspaceFurnishingSnapshot(client,session,doc,service as never)).rejects.toMatchObject({code:'ARTWORK_SNAPSHOT_CHANGED'});
 service.checkArtwork.mockRejectedValueOnce(new ApiError(403,'RIGHTS_DENIED'));await expect(assertWorkspaceFurnishingSnapshot(client,session,doc,service as never)).rejects.toMatchObject({code:'RIGHTS_DENIED'});
 service.checkDisplay.mockRejectedValueOnce(new ApiError(403,'DISPLAY_PERMISSION_REQUIRED'));await expect(assertWorkspaceFurnishingSnapshot(client,session,doc,service as never)).rejects.toMatchObject({code:'DISPLAY_PERMISSION_REQUIRED'});
 service.checkDisplay.mockRejectedValueOnce(new ApiError(409,'ASSET_INTEGRITY'));await expect(assertWorkspaceFurnishingSnapshot(client,session,doc,service as never)).rejects.toMatchObject({code:'ASSET_INTEGRITY'});
});
