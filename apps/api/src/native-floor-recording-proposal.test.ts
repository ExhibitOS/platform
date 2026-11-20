// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {WORKSPACE_MATERIAL_NAMESPACE} from '@exhibitos/spec/workspace-material';
import {FileBlobStore, sha256} from '@exhibitos/storage';
import {EXPERIENCE_NAMESPACE, FLOOR_NAMESPACE, experienceFor, type FloorSound} from '@exhibitos/studio-contract';
import type {Pool} from 'pg';
import {expect, it, vi} from 'vitest';
import {newDraft} from '../../web/src/drafts/example.ts';
import {newRoom, whiteCubeSurfaces} from '../../web/src/geometry/model.ts';
import {buildApp} from './app.ts';
import {audioMedia, type AudioRow} from './audio.ts';
import {etag} from './studio.ts';
import type {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';

function stepWav(samples = 4000) {
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}

it('proposes the exact approved step and rechecks changed workspace recordings during ordinary Save', async () => {
  let draft = newDraft();
  const tenantId = randomUUID(), userId = randomUUID(), materialId = randomUUID();
  const originalRoom = draft.candidate.rooms[0]!;
  const otherRoom = newRoom('Other room', originalRoom.dimensions,
    {position:[16,0,0], rotation:[0,0,0,1], scale:[1,1,1]});
  draft.candidate.rooms.push(otherRoom);
  draft.candidate.surfaces = [originalRoom, otherRoom].flatMap(whiteCubeSurfaces);
  const [floor, otherFloor] = draft.candidate.surfaces.filter(row => row.type === 'floor');
  const rights = {holder:'Synthetic owner', ownership:'owner' as const, licenseId:'CC0-1.0',
    creditLine:'Synthetic step', permissions:{display:true, export:true, download:false, commercial:false}};
  const material = {id:materialId, version:1, kind:'floor', name:'Synthetic stone', rights, provenance:'Synthetic',
    maps:{color:{mime:'image/png', bytes:100, sha256:'a'.repeat(64), width:10, height:10, colorSpace:'srgb'}}};
  const workspace = {version:1, materials:[material],
    bindings:[{surfaceId:floor!.id, materialId, materialVersion:1, repeatMeters:[2,2], rotation:0}]};
  const experience = experienceFor(draft.candidate);
  experience.footsteps = [{surfaceId:floor!.id, material:'stone'}, {surfaceId:otherFloor!.id, material:'wood'}];
  experience.audioDefaults = {soundOn:false};
  experience.rooms = [{roomId:originalRoom.id, reverb:.2, footstepsOn:false}];
  draft.candidate.extensions = {...draft.candidate.extensions, [WORKSPACE_MATERIAL_NAMESPACE]:workspace,
    [EXPERIENCE_NAMESPACE]:experience} as unknown as typeof draft.candidate.extensions;
  const original = structuredClone(draft);
  let revision = 3, studioOwner = userId, live = true, bytes = stepWav();
  const row:AudioRow = {tenant_id:tenantId, exhibition_id:draft.exhibitionId, id:randomUUID(), created_by:userId,
    state:'approved', revoked:false, object_key:'synthetic/step', mime:'audio/wav',
    bytes:bytes.length, sha256:sha256(bytes), duration_seconds:.5, rights};
  let approval = audioMedia(row), audioReads = 0;
  const writes:string[] = [];
  const csrf = 'floor-test', origin = 'http://127.0.0.1:13200';
  const session = {id:randomUUID(), user_id:userId, tenant_id:tenantId, role:'admin',
    csrf_hash:sha256(Buffer.from(csrf)), csrf_token:csrf, expires_at:new Date('2099-01-01T00:00:00Z')};
  const client = {query:async (sql:string, args?:unknown[]) => {
    if (sql.includes('SELECT s.*,m.role')) return {rows:[session], rowCount:1};
    if (sql.startsWith('SELECT id,revision,metadata,studio_owner_user_id FROM exhibitions'))
      return {rows:[{revision, metadata:draft, studio_owner_user_id:studioOwner}], rowCount:1};
    if (sql.startsWith('SELECT * FROM studio_audio')) {
      audioReads++;
      const matches = args?.[0] === row.tenant_id && args?.[1] === row.exhibition_id && args?.[2] === row.id;
      return {rows:matches ? [row] : [], rowCount:matches ? 1 : 0};
    }
    if (sql.startsWith('SELECT snapshot FROM audio_approvals')) return {rows:[{snapshot:approval}], rowCount:1};
    if (/^(INSERT|UPDATE)/.test(sql)) writes.push(sql);
    if (sql.startsWith('UPDATE exhibitions')) {
      draft = structuredClone(args![2] as typeof draft);
      revision = args![3] as number;
    }
    return {rows:[], rowCount:0};
  }, release:() => {}};
  const owner = {tenantId, principalId:userId, workspaceId:randomUUID(), assertDatabase:async () => {}, assertRecord:async () => {}} as never;
  const pool = {connect:async () => client, query:client.query} as unknown as Pool;
  const blobs = new FileBlobStore('/synthetic-floor-recording-test');
  vi.spyOn(blobs, 'get').mockImplementation(async () => bytes);
  const authorize = vi.fn(async () => {});
  const workspaceMaterial = {matchesBinding:() => true, work:async () => {}, authorize,
    readVersion:async (_c:unknown, _s:unknown, _id:string, version:number) => ({...material, version})} as unknown as WorkspaceMaterialIntakes;
  const app = buildApp({pool, auth:{mode:'local', origin, bindHost:'127.0.0.1'}, blobs, workspaceMaterial,
    nativeOexWorkspace:owner, nativeBoundedEditing:true, runtimeAvailable:() => live});
  const path = `/api/v1/tenants/${tenantId}/studio/exhibitions/${draft.exhibitionId}`;
  const binding = {version:1, epoch:randomUUID(), sequence:1, tenantId, principalId:userId, requestId:randomUUID()};
  const command = {type:'attach-floor-recording', surfaceId:floor!.id, materialId, materialVersion:1,
    audioId:row.id, audioRevision:1, expectedMediaAsset:audioMedia(row)};
  const headers = () => ({host:'127.0.0.1:13200', origin, cookie:`exhibitos_local_session=${'c'.repeat(43)}`,
    'x-csrf-token':csrf, 'if-match':etag(revision, draft)});
  const post = (change:Record<string,unknown> = {}, match = headers()['if-match'], expectedRevision = revision) =>
    app.inject({method:'POST', url:path+'/native-authoring-proposal', headers:{...headers(), 'if-match':match},
      payload:{expectedRevision, request:{...binding, ...command, ...change}}});
  const save = (next:typeof draft, match = headers()['if-match']) =>
    app.inject({method:'PUT', url:path, headers:{...headers(), 'if-match':match}, payload:{requestId:randomUUID(), draft:next}});
  const setSound = (sound:FloorSound) => {
    draft.candidate.extensions = {...draft.candidate.extensions, [FLOOR_NAMESPACE]:{version:1,
      bindings:[{target:{kind:'surface', surfaceId:floor!.id}, preset:'marble', repeatMeters:[1,1], rotation:0, sound}]}
    } as unknown as typeof draft.candidate.extensions;
  };
  try {
    const sessionPath = '/api/v1/auth/session';
    expect((await app.inject({method:'GET', url:sessionPath, headers:headers()})).json())
      .toMatchObject({nativeFloorRecordingAttachmentProfile:'saved-head-floor-recording-attachment-v1'});
    live = false;
    expect((await app.inject({method:'GET', url:sessionPath, headers:headers()})).json())
      .not.toHaveProperty('nativeFloorRecordingAttachmentProfile');
    live = true;
    authorize.mockRejectedValueOnce(new Error('unavailable'));
    expect((await app.inject({method:'GET', url:sessionPath, headers:headers()})).json())
      .not.toHaveProperty('nativeFloorRecordingAttachmentProfile');

    const head = headers()['if-match'];
    const reply = await post({surfaceId:floor!.id.toUpperCase()});
    expect(reply.statusCode, reply.body).toBe(200);
    const expected = structuredClone(original);
    const nextExperience = experienceFor(expected.candidate);
    nextExperience.footsteps[0]!.assetId = row.id;
    expected.candidate.mediaAssets.push(audioMedia(row));
    expected.candidate.extensions = {...expected.candidate.extensions, [EXPERIENCE_NAMESPACE]:nextExperience
    } as unknown as typeof draft.candidate.extensions;
    expect(reply.json()).toEqual({...binding, surfaceId:floor!.id, candidate:expected.candidate});
    expect(reply.headers.etag).toBe(head);
    expect(draft).toEqual(original);
    expect(writes).toEqual([]);

    expect((await post({}, etag(revision-1, draft))).statusCode).toBe(412);
    expect((await post({}, head, revision-1)).statusCode).toBe(412);
    expect((await post({principalId:randomUUID()})).statusCode).toBe(403);
    studioOwner = randomUUID();
    expect((await post()).statusCode).toBe(403);
    studioOwner = userId;
    expect((await post({surfaceId:otherFloor!.id})).json().code).toBe('FLOOR_RECORDING_TARGET_INVALID');
    expect((await post({materialVersion:2})).json().code).toBe('FLOOR_RECORDING_TARGET_INVALID');
    expect((await post({audioId:randomUUID()})).statusCode).toBe(403);
    expect((await post({audioRevision:2})).statusCode).toBe(400);
    expect((await post({candidate:expected.candidate})).statusCode).toBe(400);
    expect((await post({expectedMediaAsset:{...audioMedia(row), sha256:'f'.repeat(64)}})).json().code).toBe('AUDIO_APPROVAL_CHANGED');

    setSound({mode:'none', gain:0});
    expect((await post()).json().code).toBe('FLOOR_RECORDING_MUTED');
    const otherAudio = {...audioMedia(row), id:randomUUID()};
    otherAudio.path = `media/${otherAudio.id}/audio.wav`;
    draft.candidate.mediaAssets.push(otherAudio);
    setSound({mode:'explicit', assetIds:[otherAudio.id], gain:.5});
    expect((await post()).json().code).toBe('FLOOR_RECORDING_ALREADY_BOUND');
    const conflicting = experienceFor(draft.candidate);
    conflicting.footsteps[0]!.assetId = otherAudio.id;
    draft.candidate.extensions = {...draft.candidate.extensions, [EXPERIENCE_NAMESPACE]:conflicting
    } as unknown as typeof draft.candidate.extensions;
    setSound({mode:'material-default', gain:1});
    expect((await post()).json().code).toBe('FLOOR_RECORDING_ALREADY_BOUND');

    draft = structuredClone(expected);
    setSound({mode:'explicit', assetIds:[row.id], gain:.5});
    expect((await post()).json().candidate).toEqual(draft.candidate);
    draft = structuredClone(expected);
    expect((await post()).json().candidate).toEqual(expected.candidate);
    row.revoked = true;
    expect((await post()).json().code).toBe('AUDIO_RIGHTS_DENIED');

    draft = structuredClone(original);
    const reads = audioReads;
    expect((await save(expected, etag(revision-1, draft))).statusCode).toBe(412);
    expect(audioReads).toBe(reads);
    expect((await save(expected)).json().code).toBe('AUDIO_RIGHTS_DENIED');
    row.revoked = false;
    const lostExport = structuredClone(expected);
    row.rights = {...rights, permissions:{...rights.permissions, export:false}};
    approval = audioMedia(row);
    lostExport.candidate.mediaAssets[0] = approval;
    expect((await save(lostExport)).json().code).toBe('AUDIO_RIGHTS_DENIED');
    row.rights = rights;
    approval = {...audioMedia(row), bytes:row.bytes+2};
    expect((await save(expected)).json().code).toBe('AUDIO_APPROVAL_CHANGED');
    approval = audioMedia(row);
    bytes = Buffer.from(bytes);
    bytes[80] = 1;
    expect((await save(expected)).json().code).toBe('ASSET_INTEGRITY');

    bytes = stepWav();
    bytes.writeUInt16LE(3, 20);
    row.sha256 = sha256(bytes);
    approval = audioMedia(row);
    expect((await post({expectedMediaAsset:approval})).json().code).toBe('AUDIO_INVALID');
    bytes = stepWav(80);
    row.sha256 = sha256(bytes);
    row.bytes = bytes.length;
    approval = audioMedia(row);
    expect((await post({expectedMediaAsset:approval})).json().code).toBe('FLOOR_RECORDING_DURATION');
    expect(writes).toEqual([]);

    bytes = stepWav();
    row.sha256 = sha256(bytes);
    row.bytes = bytes.length;
    approval = audioMedia(row);
    const saved = await save(expected);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({revision:4, draft:expected});
    const reopened = await app.inject({method:'GET', url:path, headers:headers()});
    expect(reopened.json()).toEqual(saved.json());

    row.revoked = true;
    const rebound = structuredClone(draft);
    const materialV2 = {...workspace, materials:[{...material, version:2}],
      bindings:[{...workspace.bindings[0]!, materialVersion:2}]};
    rebound.candidate.extensions = {...rebound.candidate.extensions, [WORKSPACE_MATERIAL_NAMESPACE]:materialV2
    } as unknown as typeof draft.candidate.extensions;
    expect((await save(rebound)).json().code).toBe('AUDIO_RIGHTS_DENIED');
    const untouched = structuredClone(draft);
    untouched.candidate.rooms[1]!.name = 'Renamed room';
    const readsBeforeUnrelatedSave = audioReads;
    expect((await save(untouched)).statusCode).toBe(200);
    expect(audioReads).toBe(readsBeforeUnrelatedSave);
  } finally {
    await app.close();
  }
});
