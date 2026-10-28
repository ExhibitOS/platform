// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {describe,it,expect} from 'vitest';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
import {FLOOR_NAMESPACE as N,validateStudioFloors,type StudioFloors} from '@exhibitos/studio-contract';
import {checkOexProfile,remapOex} from './oex.ts';
import {projectPublication} from './publication.ts';
async function fixture(){
 const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition,room=e.rooms[0]!;
 // The stock example intentionally contains a wall only. Add a real authored floor
 // to exercise typed floor references; do not change its wall or the base profile.
 e.surfaces.push({id:'50000000-0000-4000-8000-000000000021',roomId:room.id,type:'floor',dimensions:{width:room.dimensions.width,height:room.dimensions.depth},transform:{position:[0,0,0],rotation:[-Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]}});
 return e;
}
describe('floor import and anonymous projection',()=>{
 it('preserves dormant room bases and maps floor plus explicit WAV identities through OEX',async()=>{
  const e=await fixture(),floor=e.surfaces.find(s=>s.type==='floor')!,room=e.rooms.find(r=>r.id===floor.roomId)!;
  const audio={id:'60000000-0000-4000-8000-000000000001',path:'media/step.wav',mime:'audio/wav' as const,bytes:1600,sha256:'a'.repeat(64),rights:structuredClone(e.artworks[0]!.rights)};e.mediaAssets=[audio];
  e.extensions={...e.extensions,[N]:{version:1,bindings:[{target:{kind:'surface',surfaceId:floor.id},preset:'tile',repeatMeters:[2.1,2.1],rotation:0,sound:{mode:'explicit',gain:0,assetIds:[audio.id]}},{target:{kind:'room-base',roomId:room.id},preset:'wood',repeatMeters:[1.8,1.8],rotation:0}]}};
  expect(()=>checkOexProfile(e)).not.toThrow();const mapped=remapOex(e).exhibition;expect(validateStudioFloors(mapped).valid).toBe(true);
  const value=mapped.extensions![N] as unknown as StudioFloors;expect(value.bindings[0]!.target).toEqual({kind:'surface',surfaceId:mapped.surfaces.find(s=>s.type==='floor')!.id});expect(value.bindings[0]!.sound).toEqual({mode:'explicit',gain:0,assetIds:[mapped.mediaAssets[0]!.id]});expect(value.bindings[1]!.target).toEqual({kind:'room-base',roomId:mapped.rooms.find(r=>r.name===room.name)!.id});
  e.mediaAssets=[];expect(()=>checkOexProfile(e)).toThrow('OEX_PROFILE_INVALID');
 });
 it('publishes only the validated floor namespace with typed remapping and preserves absent sound',async()=>{
  const e=await fixture(),floor=e.surfaces.find(s=>s.type==='floor')!;
  e.extensions={...e.extensions,[N]:{version:1,bindings:[{target:{kind:'surface',surfaceId:floor.id},preset:'carpet',repeatMeters:[1,1],rotation:0,normalScale:0,aoStrength:0}]},'private.example/notes':{secret:'private'}};
  const prepared=e.artworks.map(a=>({artwork:a,sourceAssetId:a.primaryAssetId,sourceSha256:a.assets[0]!.sha256,bytes:Buffer.from('synthetic'),mime:a.artworkType==='image'?'image/png' as const:'model/gltf-binary' as const}));
  const {snapshot}=projectPublication(e,prepared,'2026-10-02T00:00:00.000Z');expect(validateStudioFloors(snapshot).valid).toBe(true);const value=snapshot.extensions![N] as unknown as StudioFloors;expect(value.bindings[0]!.target).toEqual({kind:'surface',surfaceId:snapshot.surfaces.find(s=>s.type==='floor')!.id});expect(value.bindings[0]!.sound).toBeUndefined();expect(snapshot.extensions).not.toHaveProperty('private.example/notes');
  (e.extensions[N] as unknown as StudioFloors).bindings[0]!.repeatMeters=[0,1];expect(()=>projectPublication(e,prepared,'2026-10-02T00:00:00.000Z')).toThrow('PUBLICATION_NOT_READY');
 });
 it('rejects a floor WAV omitted from prepared public inventory and remaps an included WAV',async()=>{
  const e=await fixture(),floor=e.surfaces.find(s=>s.type==='floor')!;
  const source={id:'60000000-0000-4000-8000-000000000001',path:'media/step.wav',mime:'audio/wav' as const,bytes:1600,sha256:'a'.repeat(64),rights:structuredClone(e.artworks[0]!.rights)};e.mediaAssets=[source];
  e.extensions={...e.extensions,[N]:{version:1,bindings:[{target:{kind:'surface',surfaceId:floor.id},preset:'tile',repeatMeters:[2.1,2.1],rotation:0,sound:{mode:'explicit',gain:1,assetIds:[source.id]}}]}};
  const prepared=e.artworks.map(a=>({artwork:a,sourceAssetId:a.primaryAssetId,sourceSha256:a.assets[0]!.sha256,bytes:Buffer.from('synthetic'),mime:a.artworkType==='image'?'image/png' as const:'model/gltf-binary' as const}));
  expect(()=>projectPublication(e,prepared,'2026-10-02T00:00:00.000Z')).toThrow('PUBLICATION_NOT_READY');
  const {snapshot}=projectPublication(e,prepared,'2026-10-02T00:00:00.000Z',[{source,bytes:Buffer.alloc(1600)}]);expect(validateStudioFloors(snapshot).valid).toBe(true);
  const value=snapshot.extensions![N] as unknown as StudioFloors;expect(value.bindings[0]!.sound).toEqual({mode:'explicit',gain:1,assetIds:[snapshot.mediaAssets[0]!.id]});expect(snapshot.mediaAssets[0]!.id).not.toBe(source.id);
 });
});
