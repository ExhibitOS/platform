import {VIEWING_PLAN_NAMESPACE,viewingPlanFor,validateViewingPlan,presentationFor} from '@exhibitos/studio-contract';
import {SPATIAL_NAMESPACE,spatialProgramFor,validateSpatialProfile} from '@exhibitos/studio-contract';
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fixtureURL, validateExhibition, type Exhibition } from "@exhibitos/spec";
import { sha256 } from "@exhibitos/storage";
import { CURATION_NAMESPACE,curationFor,validateViewerCuration,MATERIAL_NAMESPACE, PRESENTATION_NAMESPACE, validateStudioMaterials, validateStudioPresentation, EXPERIENCE_NAMESPACE, experienceFor, validateViewerExperience, ARTWORK_DETAILS_NAMESPACE, creationYearFor } from "@exhibitos/studio-contract";
import { projectPublication, approvedPublicationSource, authorizedArtworkAssets, admitOptionalThumbnails } from "./publication.ts";
import { ENTRANCE_NAMESPACE, entranceFor, validateViewerEntrance } from '@exhibitos/studio-contract';
import {LOD_NAMESPACE,validateViewerLod} from '@exhibitos/studio-contract';
import {remapOex,checkOexProfile} from './oex.ts';
import {ARTWORK_THUMBNAIL_NAMESPACE,artworkThumbnailFor} from '@exhibitos/studio-contract';
it('rejects staged descriptors at the exported publication projection boundary',async()=>{
 const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition,a=e.artworks[0]!,primary=a.assets.find(asset=>asset.id===a.primaryAssetId)!;
 const forged={offset:0,length:1,sha256:'0'.repeat(64)};
 expect(()=>projectPublication(e,[{artwork:a,sourceAssetId:primary.id,sourceSha256:primary.sha256,bytes:forged,mime:'model/gltf-binary'}],'2026-10-01T00:00:00Z')).toThrow('PUBLICATION_NOT_READY');
});
it('projects only an exact approved thumbnail and keeps its source authority distinct',async()=>{
 const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition,a=e.artworks.find(x=>x.artworkType==='sculpture')!,primary=a.assets.find(x=>x.id===a.primaryAssetId)!;
 const preview={id:crypto.randomUUID(),path:'assets/thumb.png',role:'preview' as const,mime:'image/png' as const,bytes:10,sha256:'a'.repeat(64)};a.assets.push(preview);a.extensions={...a.extensions,[ARTWORK_THUMBNAIL_NAMESPACE]:{version:1,assetId:preview.id}};
 e.artworks=[a];e.placements=e.placements.filter(p=>p.artworkRevisionId===a.revisionId);e.accessibility.artworkDescriptions=e.accessibility.artworkDescriptions.filter(d=>e.placements.some(p=>p.id===d.placementId));
 expect(approvedPublicationSource({asset:primary,importedArtwork:a},preview,primary.id)).toBe(true);
 expect(approvedPublicationSource({asset:primary,importedArtwork:a,modelPair:{version:1}},preview,primary.id)).toBe(true);
 expect(approvedPublicationSource({asset:primary,importedArtwork:a,modelPair:{version:1}},{...preview,sha256:'b'.repeat(64)},primary.id)).toBe(false);
 expect(approvedPublicationSource({asset:primary,importedArtwork:a},{...preview,sha256:'b'.repeat(64)},primary.id)).toBe(false);
 expect(approvedPublicationSource({asset:primary},preview,primary.id)).toBe(false);
 const result=projectPublication(e,[{artwork:a,sourceAssetId:primary.id,sourceSha256:primary.sha256,bytes:Buffer.from('model'),mime:'model/gltf-binary',thumbnail:{sourceAssetId:preview.id,sourceSha256:preview.sha256,bytes:Buffer.from('small')}}],'2026-10-24T00:00:00Z');
 const budgeted=[{artwork:a,sourceAssetId:primary.id,sourceSha256:primary.sha256,bytes:Buffer.from('model'),mime:'model/gltf-binary' as const,thumbnail:{sourceAssetId:preview.id,sourceSha256:preview.sha256,bytes:Buffer.from('small')}}];
 admitOptionalThumbnails(budgeted,98,100);expect(budgeted[0]!.thumbnail).toBeUndefined();
 const selected=artworkThumbnailFor(result.snapshot.artworks[0]!);expect(selected).toMatchObject({role:'preview',mime:'image/png',bytes:5,sha256:sha256(Buffer.from('small'))});
 expect(result.assets.find(x=>x.id===selected!.id)!.prepared).toMatchObject({sourceAssetId:preview.id,sourceSha256:preview.sha256,mime:'image/png'});
 const rights={holder:'Synthetic',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:false,export:false,commercial:false},creditLine:'Synthetic'};
 const metadata={title:'Synthetic',description:'',dimensions:{width:1,height:1,unit:'m'},rights,provenance:{source:'synthetic',sourceUnits:'m',scaleApplied:true,notes:''}};
 const records=result.assets.map(({id,prepared})=>{if(!Buffer.isBuffer(prepared.bytes))throw Error('Expected projected Buffer');return {id,artwork_id:a.id,artwork_revision:1,source_asset_id:prepared.sourceAssetId,source_sha256:prepared.sourceSha256,object_key:'synthetic',sha256:sha256(prepared.bytes),bytes:prepared.bytes.length,mime:prepared.mime,asset_state:'approved',current_revision:1,approved_revision:1,source_artwork_id:a.id,source_approval:{asset:primary,importedArtwork:a},current_source_bytes:prepared.sourceAssetId===primary.id?primary.bytes:preview.bytes,current_source_mime:prepared.sourceAssetId===primary.id?primary.mime:preview.mime,approved_asset_id:primary.id,current_source_sha256:prepared.sourceSha256,current_metadata:metadata,current_rights:rights};});
 expect(authorizedArtworkAssets(result.snapshot,records,Date.now())).toHaveLength(2);
 const edited=records.map(r=>({...r,current_revision:2,approved_revision:null,approved_asset_id:null,current_metadata:{...metadata,title:'Later private title'}}));
 expect(authorizedArtworkAssets(result.snapshot,edited,Date.now())).toHaveLength(2);
 const newlyApproved=edited.map(r=>({...r,approved_revision:2,approved_asset_id:crypto.randomUUID()}));
 expect(authorizedArtworkAssets(result.snapshot,newlyApproved,Date.now())).toHaveLength(2);
 const wrongHistoricalPrimary=edited.map(r=>({...r,source_approval:{...r.source_approval,asset:{...primary,id:crypto.randomUUID()}}}));
 expect(()=>authorizedArtworkAssets(result.snapshot,wrongHistoricalPrimary,Date.now())).toThrow('PUBLICATION_UNAVAILABLE');
 const expired=edited.map(r=>({...r,current_rights:{...rights,expiresAt:'2000-01-01T00:00:00Z'}}));
 expect(()=>authorizedArtworkAssets(result.snapshot,expired,Date.now())).toThrow('PUBLICATION_UNAVAILABLE');
 const withoutPreview=records.filter(x=>x.id!==selected!.id);expect(authorizedArtworkAssets(result.snapshot,withoutPreview,Date.now())).toHaveLength(1);
 const denied=records.map(x=>x.id===selected!.id?{...x,current_rights:{...rights,permissions:{...rights.permissions,display:false}}}:x);expect(authorizedArtworkAssets(result.snapshot,denied,Date.now())).toHaveLength(1);
 expect(()=>authorizedArtworkAssets(result.snapshot,records.filter(x=>x.id===selected!.id),Date.now())).toThrow('PUBLICATION_UNAVAILABLE');
 const receiptRecords=records.map(x=>x.id===selected!.id?{...x,source_approval:{asset:primary},receipt_artwork_id:a.id,receipt_revision:1,receipt_source_id:primary.id,receipt_source_sha256:primary.sha256,receipt_thumbnail_id:preview.id,receipt_sha256:preview.sha256,receipt_bytes:preview.bytes}:x);
 expect(authorizedArtworkAssets(result.snapshot,receiptRecords,Date.now())).toHaveLength(2);
 expect(authorizedArtworkAssets(result.snapshot,receiptRecords.map(x=>x.id===selected!.id?{...x,receipt_source_sha256:'b'.repeat(64)}:x),Date.now())).toHaveLength(1);
 expect(authorizedArtworkAssets(result.snapshot,receiptRecords.map(x=>x.id===selected!.id?{...x,receipt_artwork_id:crypto.randomUUID()}:x),Date.now())).toHaveLength(1);
 const deniedPrimary=records.map(x=>x.id!==selected!.id?{...x,current_rights:{...rights,permissions:{...rights.permissions,display:false}}}:x);expect(()=>authorizedArtworkAssets(result.snapshot,deniedPrimary,Date.now())).toThrow('PUBLICATION_UNAVAILABLE');
 const shared=structuredClone(result.snapshot),other=structuredClone(shared.artworks[0]!);other.artworkType='image';other.primaryAssetId=selected!.id;other.assets=[{...selected!,role:'image'}];delete other.extensions?.[ARTWORK_THUMBNAIL_NAMESPACE];shared.artworks.push(other);
 expect(()=>authorizedArtworkAssets(shared,withoutPreview,Date.now())).toThrow('PUBLICATION_UNAVAILABLE');
});
it('preserves authored PNG coarse/full through public projection and typed OEX identity remap',async()=>{
 const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition,a=e.artworks.find(a=>a.artworkType==='image')!,primary=a.assets.find(v=>v.id===a.primaryAssetId)!;
 primary.bytes=1000;const coarse={...primary,id:crypto.randomUUID(),path:'assets/coarse.png',bytes:100,sha256:'b'.repeat(64)};a.assets.push(coarse);a.extensions={[LOD_NAMESPACE]:{version:1,variants:[{assetId:primary.id,detail:'full',textureSize:2048},{assetId:coarse.id,detail:'coarse',textureSize:512}]}};
 e.artworks=[a];e.placements=e.placements.filter(p=>p.artworkRevisionId===a.revisionId);e.accessibility.artworkDescriptions=e.accessibility.artworkDescriptions.filter(d=>e.placements.some(p=>p.id===d.placementId));
 expect(approvedPublicationSource({asset:primary,importedArtwork:a},coarse,primary.id)).toBe(true);
 const wrongPrimary=structuredClone(a);wrongPrimary.assets.find(v=>v.id===primary.id)!.sha256='c'.repeat(64);
 expect(approvedPublicationSource({asset:primary,importedArtwork:wrongPrimary},coarse,primary.id)).toBe(false);
 const result=projectPublication(e,[{artwork:a,sourceAssetId:primary.id,sourceSha256:primary.sha256,coarseSource:{id:coarse.id,sha256:coarse.sha256},bytes:Buffer.alloc(1000),mime:'image/png',variants:{full:{textureSize:2048},coarse:{textureSize:512},bytes:Buffer.alloc(100)}}],'2026-10-24T00:00:00Z');
 const published=result.snapshot.artworks[0]!;expect(validateViewerLod(published).valid).toBe(true);expect(published.assets).toHaveLength(2);expect(result.assets[1]!.prepared.sourceAssetId).toBe(coarse.id);
 const remapped=remapOex(result.snapshot).exhibition;expect(()=>checkOexProfile(remapped)).not.toThrow();expect(validateViewerLod(remapped.artworks[0]!).valid).toBe(true);
 const lod=remapped.artworks[0]!.extensions![LOD_NAMESPACE] as unknown as {variants:{assetId:string;detail:string}[]};expect(lod.variants.find(v=>v.detail==='full')!.assetId).toBe(remapped.artworks[0]!.primaryAssetId);expect(lod.variants.every(v=>remapped.artworks[0]!.assets.some(a=>a.id===v.assetId))).toBe(true);
});
describe("immutable anonymous publication projection", () => {
    it('remaps scalar and textured surface identities together without changing authored sampling',async()=>{
        const candidate=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;
        const surface=candidate.surfaces[0]!;surface.type='wall';
        const texture={pack:{id:'museum-matte-paint',version:1},repeatMeters:[1.3,2.1],rotation:.2,normalScale:.6};
        candidate.extensions={[MATERIAL_NAMESPACE]:{version:1,surfaces:{[surface.id.toUpperCase()]:{color:'#abcdef',roughness:.41,metalness:.1}},surfaceTextures:{[surface.id.toUpperCase()]:texture}}};
        const before=structuredClone(candidate);
        const {snapshot}=projectPublication(candidate,[],'2026-10-27T00:00:00Z');
        const published=snapshot.extensions![MATERIAL_NAMESPACE] as unknown as {surfaces:Record<string,unknown>;surfaceTextures:Record<string,unknown>};
        expect(snapshot.surfaces[0]!.id).not.toBe(surface.id);
        expect(Object.keys(published.surfaces)).toEqual([snapshot.surfaces[0]!.id]);
        expect(published.surfaceTextures).toEqual({[snapshot.surfaces[0]!.id]:texture});
        expect(validateStudioMaterials(snapshot)).toEqual({valid:true,errors:[]});
        expect(candidate).toEqual(before);
        surface.type='floor';
        expect(()=>projectPublication(candidate,[],'2026-10-27T00:00:00Z')).toThrow('PUBLICATION_NOT_READY');
    });
    it('recorded step bank follows typed OEX and public media IDs without mutating the authored binding',async()=>{
        const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;
        e.surfaces[0]!.type='floor';
        const sources=[1,2].map(n=>({id:`60000000-0000-4000-8000-00000000000${n}`,path:`media/step${n}.wav`,mime:'audio/wav' as const,bytes:1600,sha256:sha256(Buffer.alloc(1600)),rights:structuredClone(e.artworks[0]!.rights)}));
        e.mediaAssets=sources;e.extensions={[EXPERIENCE_NAMESPACE]:{version:1,footsteps:[{surfaceId:e.surfaces.find(s=>s.type==='floor')!.id,material:'wood',bank:sources.map(s=>({assetId:s.id.toUpperCase()}))}],voices:[],annotations:[],rooms:[],translations:[]}};
        const before=structuredClone(e),mapped=remapOex(e).exhibition;
        const binding=(doc:Exhibition)=>doc.extensions![EXPERIENCE_NAMESPACE] as unknown as {footsteps:{surfaceId:string;bank:{assetId:string}[]}[]};
        expect(binding(mapped).footsteps[0]!.bank.map(s=>s.assetId)).toEqual(mapped.mediaAssets.map(s=>s.id));expect(binding(mapped).footsteps[0]!.surfaceId).toBe(mapped.surfaces.find(s=>s.type==='floor')!.id);
        const prepared=e.artworks.map(a=>({artwork:a,sourceAssetId:a.primaryAssetId,sourceSha256:a.assets[0]!.sha256,bytes:Buffer.from('synthetic bytes'),mime:a.artworkType==='image'?'image/png' as const:'model/gltf-binary' as const}));
        const {snapshot,media}=projectPublication(e,prepared,'2026-10-24T00:00:00.000Z',sources.map(source=>({source,bytes:Buffer.alloc(1600)})));
        expect(binding(snapshot).footsteps[0]!.bank.map(s=>s.assetId)).toEqual(media.map(s=>s.id));expect(binding(snapshot).footsteps[0]!.surfaceId).toBe(snapshot.surfaces.find(s=>s.type==='floor')!.id);expect(e).toEqual(before);
    });
    it('publishes only the approved PNG cover reference and preserves UUID-shaped public prose', async () => {
        const candidate = JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'), 'utf8')) as Exhibition;
        const image = candidate.artworks.find(a => a.artworkType === 'image')!;
        const presentation={ticketTitle:image.primaryAssetId,ticketDetail:'Public ticket detail',ticketAnimation:false,coverUnfold:true,doorEffect:false};
        candidate.extensions = { [ENTRANCE_NAMESPACE]: { version: 1, artist: image.primaryAssetId, introduction: 'Public cover text', imageAssetId: image.primaryAssetId.toUpperCase(), imageAlt: 'Synthetic painting', mobilePosition: 'center',presentation }, 'private.example/notes': { token: 'private' } };
        const original = structuredClone(candidate);
        const prepared = candidate.artworks.map(a => ({ artwork: a, sourceAssetId: a.primaryAssetId, sourceSha256: a.assets[0]!.sha256, bytes: Buffer.from('Synthetic qualified bytes'), mime: a.artworkType === 'image' ? 'image/png' as const : 'model/gltf-binary' as const }));
        const { snapshot } = projectPublication(candidate, prepared, '2026-10-23T10:00:00.000Z');
        expect(validateViewerEntrance(snapshot).valid).toBe(true);
        expect(entranceFor(snapshot).imageAssetId).toBe(snapshot.artworks.find(a => a.artworkType === 'image')!.primaryAssetId);
        expect(entranceFor(snapshot).imageAssetId).not.toBe(image.primaryAssetId);
        expect(entranceFor(snapshot).artist).toBe(image.primaryAssetId);
        expect(entranceFor(snapshot).presentation).toEqual(presentation);
        expect(snapshot.extensions).not.toHaveProperty('private.example/notes');
        expect(candidate).toEqual(original);
    });
    it('preserves author rule IDs and UUID-shaped text while mapping only executable scene references',async()=>{
        const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;
        e.extensions={[SPATIAL_NAMESPACE]:{version:1,rules:[{id:'author-rule',once:true,trigger:{type:'room_enter',roomId:e.rooms[0]!.id},actions:[{type:'set_light',lightId:e.lights[0]!.id,multiplier:.4,delayMs:0},{type:'show_text',text:e.lights[0]!.id,locale:'en',delayMs:0}]}]}};
        const prepared=e.artworks.map(a=>({artwork:a,sourceAssetId:a.primaryAssetId,sourceSha256:a.assets[0]!.sha256,bytes:Buffer.from('synthetic'),mime:a.artworkType==='image'?'image/png' as const:'model/gltf-binary' as const}));
        const {snapshot}=projectPublication(e,prepared,'2026-10-02T00:00:00.000Z'),p=spatialProgramFor(snapshot);
        expect(validateSpatialProfile(snapshot).valid).toBe(true);expect(p.rules[0]!.id).toBe('author-rule');expect(p.rules[0]!.trigger).toEqual({type:'room_enter',roomId:snapshot.rooms[0]!.id});expect(p.rules[0]!.actions[0]).toMatchObject({lightId:snapshot.lights[0]!.id});expect(p.rules[0]!.actions[1]).toMatchObject({text:e.lights[0]!.id});expect(snapshot.lights[0]!.id).not.toBe(e.lights[0]!.id);
    });

    it("remaps all references, strips private and foreign extensions, and inventories actual qualified bytes", async () => {
        const candidate = JSON.parse(await readFile(fixtureURL("oes/v1/examples/exhibition.json"), "utf8")) as Exhibition;
        candidate.extensions = { "private.example/notes": { secret: "Private authoring extension" }, [MATERIAL_NAMESPACE]: { version: 1, surfaces: { [candidate.surfaces[0]!.id]: { color: "#112233", roughness: 0.5, metalness: 0 } } }, [PRESENTATION_NAMESPACE]: { version: 1, viewpoints: [], credits: "Public credit", startCamera: { roomId: candidate.rooms[0]!.id, position: [0, 1.6, 3], target: [0, 1.6, 0], fov: 60 } } };
        for (const artwork of candidate.artworks)
            artwork.extensions = { "org.exhibitos.studio/cms": { tenantId: "10000000-0000-4000-8000-000000000001", artworkId: artwork.id, revision: artwork.revision }, [ARTWORK_DETAILS_NAMESPACE]:{version:1,creationYear:2024}, "private.example/capture": { secret: "Original capture note" } };
        candidate.artworks[0]!.rights.licenseId = candidate.rooms[0]!.id;
        candidate.artworks[0]!.transform={position:[1,2,3],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2],scale:[2,1,1]};
        const before = structuredClone(candidate);
        const prepared = candidate.artworks.map(a => ({ artwork: a, sourceAssetId: a.primaryAssetId, sourceSha256: a.assets[0]!.sha256, bytes: Buffer.from(`Qualified synthetic derivative ${a.id}`), mime: a.artworkType === "image" ? "image/png" as const : "model/gltf-binary" as const }));
        const { snapshot, assets } = projectPublication(candidate, prepared, "2026-10-01T00:00:00.000Z");
        expect(validateExhibition(snapshot, { publicationTime: "2026-10-01T00:00:00.000Z" })).toEqual({ valid: true, errors: [] });
        expect(validateStudioMaterials(snapshot).valid).toBe(true);
        expect(validateStudioPresentation(snapshot).valid).toBe(true);
        expect(candidate).toEqual(before);
        expect(snapshot.id).not.toBe(candidate.id);
        expect(snapshot.rooms[0]!.id).not.toBe(candidate.rooms[0]!.id);
        expect(snapshot.artworks[0]!.rights.licenseId).toBe(candidate.rooms[0]!.id);
        expect(snapshot.artworks[0]!.rights).toEqual(candidate.artworks[0]!.rights);
        expect(JSON.stringify(snapshot)).not.toContain("Private");
        expect(JSON.stringify(snapshot)).not.toContain("capture");
        expect(JSON.stringify(snapshot)).not.toContain("org.exhibitos.studio/cms");
        for (const [i, a] of snapshot.artworks.entries()) {
            expect(a.transform).toEqual(candidate.artworks[i]!.transform);expect(a.id).not.toBe(candidate.artworks[i]!.id);
            expect(creationYearFor(a)).toBe(2024);
            expect(a.revisionId).not.toBe(candidate.artworks[i]!.revisionId);
            expect(a.primaryAssetId).not.toBe(candidate.artworks[i]!.primaryAssetId);
            expect(a.assets[0]!.id).toBe(assets[i]!.id);
            expect(a.assets[0]!.sha256).toBe(sha256(prepared[i]!.bytes));
            expect(a.assets[0]!.bytes).toBe(prepared[i]!.bytes.length);
        }
        expect(snapshot.placements[0]!.artworkRevisionId).toBe(snapshot.artworks[0]!.revisionId);
        expect(snapshot.placements[0]!.roomId).toBe(snapshot.rooms[0]!.id);
    });
    it("remaps approved media references while preserving original and translated text verbatim", async () => {
        const candidate=JSON.parse(await readFile(fixtureURL("oes/v1/examples/exhibition.json"),"utf8")) as Exhibition;
        const source={id:"60000000-0000-4000-8000-000000000001",path:"media/60000000-0000-4000-8000-000000000001/audio.wav",mime:"audio/wav" as const,bytes:1600,sha256:sha256(Buffer.alloc(1600)),rights:structuredClone(candidate.artworks[0]!.rights)};
        candidate.mediaAssets=[source];
        candidate.audioZones=[{id:"60000000-0000-4000-8000-000000000002",roomId:candidate.rooms[0]!.id,assetId:source.id,position:[0,1,0],radius:3,volume:0.5,autoplay:false,transcript:source.id}];
        const original=source.id;
        candidate.extensions={[EXPERIENCE_NAMESPACE]:{version:1,footsteps:[],voices:[{placementId:candidate.placements[0]!.id,assetId:source.id,transcript:original,locale:"en"}],annotations:[{annotationId:candidate.annotations[0]!.id,position:[0,0,0]}],rooms:[{roomId:candidate.rooms[0]!.id,reverb:0.3}],translations:[{placementId:candidate.placements[0]!.id,locale:"ko",title:original,description:original}]}};
        candidate.extensions![CURATION_NAMESPACE]={version:1,audioZones:[{zoneId:candidate.audioZones[0]!.id,referenceDistance:1,maxDistance:20,rolloff:1,occlusion:{enabled:true,closedGain:0.2}}],transcripts:[{placementId:candidate.placements[0]!.id,locale:'en',durationSeconds:2,cues:[{start:0,end:1,text:original}],translations:[{locale:'ko',cues:[{start:0,end:1,text:original}]}]}],annotationTranslations:[{annotationId:candidate.annotations[0]!.id,locale:'ko',text:original}],routes:candidate.navigation.map(r=>({routeId:r.id,stops:r.waypoints.map((_w,i)=>({waypointIndex:i,title:original,description:original}))}))};
        const prepared=candidate.artworks.map(a=>({artwork:a,sourceAssetId:a.primaryAssetId,sourceSha256:a.assets[0]!.sha256,bytes:Buffer.from("synthetic bytes"),mime:a.artworkType==="image"?"image/png" as const:"model/gltf-binary" as const}));
        const {snapshot,media}=projectPublication(candidate,prepared,"2026-10-01T00:00:00.000Z",[{source,bytes:Buffer.alloc(1600)}]);
        expect(validateExhibition(snapshot,{publicationTime:"2026-10-01T00:00:00.000Z"}).valid).toBe(true);
        expect(validateViewerExperience(snapshot).valid).toBe(true);
        expect(validateViewerCuration(snapshot).valid).toBe(true);
        const curation=curationFor(snapshot);
        expect(curation.audioZones[0]!.zoneId).toBe(snapshot.audioZones[0]!.id);
        expect(curation.transcripts[0]!.placementId).toBe(snapshot.placements[0]!.id);
        expect(curation.transcripts[0]!.cues[0]!.text).toBe(original);
        expect(curation.transcripts[0]!.translations[0]!.cues[0]!.text).toBe(original);
        expect(curation.annotationTranslations[0]!.annotationId).toBe(snapshot.annotations[0]!.id);
        expect(curation.routes[0]!.routeId).toBe(snapshot.navigation[0]!.id);
        expect(curation.routes[0]!.stops[0]!.title).toBe(original);
        const experience=experienceFor(snapshot);
        expect(snapshot.mediaAssets[0]!.id).toBe(media[0]!.id);
        expect(snapshot.mediaAssets[0]!.path).toBe(`media/${media[0]!.id}/audio.wav`);
        expect(media[0]!.id).not.toBe(source.id);
        expect(snapshot.audioZones[0]!.assetId).toBe(media[0]!.id);
        expect(experience.voices[0]!.assetId).toBe(media[0]!.id);
        expect(experience.voices[0]!.placementId).toBe(snapshot.placements[0]!.id);
        expect(experience.annotations[0]!.annotationId).toBe(snapshot.annotations[0]!.id);
        expect(experience.rooms[0]!.roomId).toBe(snapshot.rooms[0]!.id);
        expect(experience.voices[0]!.transcript).toBe(original);
        expect(experience.translations[0]!.title).toBe(original);
        expect(snapshot.audioZones[0]!.transcript).toBe(original);
    });
});

describe('immutable secondary LOD source gate',()=>{
 it('only accepts exact imported coarse approval while preserving primary source compatibility',async()=>{
  const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition,a=e.artworks.find(a=>a.artworkType==='sculpture')!;
  const primary=a.assets.find(v=>v.id===a.primaryAssetId)!;
  const coarse={...primary,id:'10000000-0000-4000-8000-000000000098',path:'assets/coarse.glb',sha256:'b'.repeat(64),bytes:primary.bytes-1};
  a.assets.push(coarse);a.extensions={ [ 'org.exhibitos.viewer/lod' ]:{version:1,variants:[{assetId:primary.id,detail:'full',triangles:8},{assetId:coarse.id,detail:'coarse',triangles:2}]}};
  const snapshot={asset:primary,importedArtwork:a};
  expect(approvedPublicationSource({asset:primary},primary,primary.id)).toBe(true);
  expect(approvedPublicationSource(snapshot,coarse,primary.id)).toBe(true);
  for(const bad of [{...coarse,id:'10000000-0000-4000-8000-000000000099'},{...coarse,sha256:'c'.repeat(64)},{...coarse,bytes:coarse.bytes+1},{...coarse,mime:'image/png'}])expect(approvedPublicationSource(snapshot,bad,primary.id)).toBe(false);
  expect(approvedPublicationSource({asset:primary},coarse,primary.id)).toBe(false);
  expect(approvedPublicationSource(snapshot,coarse,coarse.id)).toBe(false);
  a.extensions!['org.exhibitos.viewer/lod']={version:1,variants:[{assetId:primary.id,detail:'full',triangles:8},{assetId:primary.id,detail:'coarse',triangles:2}]};
  expect(approvedPublicationSource(snapshot,coarse,primary.id)).toBe(false);
 });
});

describe('explicit approved LOD projection and unsupported fallback',()=>{
 it('full-only prepared result strips stale coarse declaration and secondary assets',async()=>{
  const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;
  const a=e.artworks.find(a=>a.artworkType==='sculpture')!,primary=a.assets.find(v=>v.id===a.primaryAssetId)!,coarse={...primary,id:'10000000-0000-4000-8000-000000000098',path:'synthetic/coarse.glb',bytes:primary.bytes-1};a.assets.push(coarse);a.extensions={'org.exhibitos.viewer/lod':{version:1,variants:[{assetId:primary.id,detail:'full',triangles:8},{assetId:coarse.id,detail:'coarse',triangles:2}]}};
  const result=projectPublication(e,[{artwork:a,sourceAssetId:primary.id,sourceSha256:primary.sha256,bytes:Buffer.from('qualified full display'),mime:'model/gltf-binary',variants:{full:{triangles:8,textureSize:2}}}],'2026-10-01T00:00:00Z');
  expect(result.snapshot.artworks[0]!.assets).toHaveLength(1);expect(result.assets).toHaveLength(1);
  expect(result.snapshot.artworks[0]!.extensions?.['org.exhibitos.viewer/lod']).toEqual({version:1,variants:[{assetId:result.snapshot.artworks[0]!.primaryAssetId,detail:'full',triangles:8}]});
 });
 it('approved secondary source ID/hash remains private exact binding while public IDs are regenerated',async()=>{
  const e=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition,a=e.artworks.find(a=>a.artworkType==='sculpture')!,primary=a.assets.find(v=>v.id===a.primaryAssetId)!,id='10000000-0000-4000-8000-000000000098',hash='b'.repeat(64);
  const result=projectPublication(e,[{artwork:a,sourceAssetId:primary.id,sourceSha256:primary.sha256,coarseSource:{id,sha256:hash},bytes:Buffer.from('qualified full display bytes'),mime:'model/gltf-binary',variants:{full:{triangles:8,textureSize:2},coarse:{triangles:2,textureSize:2},bytes:Buffer.from('coarse')}}],'2026-10-01T00:00:00Z');
  expect(result.assets[1]!.prepared.sourceAssetId).toBe(id);expect(result.assets[1]!.prepared.sourceSha256).toBe(hash);expect(result.snapshot.artworks[0]!.assets[1]!.id).not.toBe(id);expect(result.snapshot.artworks[0]!.transform).toEqual(a.transform);
 });
});

it('preserves viewing-plan order and orbit through publication and OEX while rejecting dangling authored references',async()=>{
 const candidate=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;
 const placements=[candidate.placements[1]!,candidate.placements[2]!];
 const viewpoints=placements.map((p,i)=>({id:crypto.randomUUID(),name:p.id,roomId:p.roomId,position:[i,1.65,2],target:[0,1,0],fov:50}));
 const orbit={minYaw:-1,maxYaw:1};
 candidate.extensions={
  [PRESENTATION_NAMESPACE]:{version:1,viewpoints,credits:viewpoints[0]!.id},
  [VIEWING_PLAN_NAMESPACE]:{version:1,stops:placements.map((p,i)=>({placementId:p.id.toUpperCase(),viewpointId:viewpoints[i]!.id.toUpperCase(),...(i===0?{orbit}:{})}))},
 };
 expect(validateViewingPlan(candidate).valid).toBe(true);expect(()=>checkOexProfile(candidate)).not.toThrow();
 const before=structuredClone(candidate);
 const prepared=candidate.artworks.map(a=>({artwork:a,sourceAssetId:a.primaryAssetId,sourceSha256:a.assets[0]!.sha256,bytes:Buffer.from('Synthetic qualified display'),mime:a.artworkType==='image'?'image/png' as const:'model/gltf-binary' as const}));
 const published=projectPublication(candidate,prepared,'2026-10-28T00:00:00Z').snapshot;
 const copied=remapOex(candidate).exhibition,roundtrip=remapOex(published).exhibition;
 for(const output of [published,copied,roundtrip]){
  expect(validateViewingPlan(output)).toEqual({valid:true,errors:[]});expect(()=>checkOexProfile(output)).not.toThrow();
  const stops=viewingPlanFor(output).stops,views=presentationFor(output).viewpoints;
  expect(stops.map(s=>s.placementId)).toEqual([output.placements[1]!.id,output.placements[2]!.id]);
  expect(stops.map(s=>s.viewpointId)).toEqual(views.map(v=>v.id));expect(stops[0]!.orbit).toEqual(orbit);expect(stops[1]!.orbit).toBeUndefined();
  expect(stops[0]!.placementId).not.toBe(placements[0]!.id);expect(stops[0]!.viewpointId).not.toBe(viewpoints[0]!.id);
  expect(views.map(v=>({position:v.position,target:v.target,fov:v.fov,name:v.name}))).toEqual(viewpoints.map(v=>({position:v.position,target:v.target,fov:v.fov,name:v.name})));
  expect(presentationFor(output).credits).toBe(viewpoints[0]!.id);
 }
 expect(candidate).toEqual(before);
 const dangling=structuredClone(candidate);(dangling.extensions![PRESENTATION_NAMESPACE] as {viewpoints:unknown[]}).viewpoints=[];
 expect(()=>projectPublication(dangling,prepared,'2026-10-28T00:00:00Z')).toThrow('PUBLICATION_NOT_READY');expect(()=>checkOexProfile(dangling)).toThrow('OEX_PROFILE_INVALID');
});
