// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve, sep} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {revisionHash, validateExhibition} from '@exhibitos/spec';
import {validateViewerExperience} from '@exhibitos/studio-contract';
import {bindDerivedStaticCover} from './derived-static-cover.mjs';
import {localStaticPublicationSource} from './local-static-publication-source.mjs';

const base = {
  publicationId: '63719dad-65d3-41e9-86a8-57304976e142',
  sourceManifestSha256: 'bf8c96d78509a82746ed869c027c790e52aaa371f813487a5714ae9c3d822cb4',
  indexSha256: '949977df7cd80a60d8a4d811a84cc3812b505f2244093bbf97e9cfe65e387267',
  bodySha256: 'f86edd2ec99199fa02afed3d943890567fce31419ce62aa32fa669cc4652d6e1',
  entrySha256: 'c07f0a0fc8ba9de23a73827ce88711fb0b72f68618cf6bdd334971ad9f9bace7',
  revisionSha256: '970b0df60c006efa82f1df54767cea626620bdbf73d374a6a91f37ca8b93ea83',
  viewerBuildId: 'e231cf826f7fc7aeb46a3c215b35ea7f49834989f74ada0972f205fccdf66901',
  audioChunkSha256: 'aabce8d7301975199ce6f8efb7ad16b94d9956984f2af501c62a02d81484b76d',
  deployment: '3d0e93a0aef0e5c0c5792d0f6555a871ea8308338f5ed383057d22106ab95bba',
  projection: '2062a1759b8e7e514bc59f6f069356c376d46c334ac3a81492c3db5284c6631d',
};
const authority = {
  priorJournal: 'd2fa5367a663c0031f38178a624c7a53e37118557691f3ebf16bfc85d856aaf5',
  journal: '11c0e78069d48cb44f73d88d6e43991dd8335d1e4e803d48109c4445322c7588',
  normalReturn: '41e6a52c4a0657a0ad602c8370ab6b21cadeec1d722378cc2a199109fcec1ca2',
  validated: '49f0afd9765796ebb99513311fc7bc6e937c2ca2d487c552914bac2bdf42306c',
  approved: '52f71ac9bee940c61a78036d4f09667d4d6365d6ff9070986c0385eade4a2b14',
  save: '46952f8d4f1d0e04c478d865c61b79a78ca8a9d84e100643793feff9478aed7f',
  reopen: '3c65cb9845d1fccd4c5698724f6d73e41b4156e606ca63afd2567c7e70178eaa',
  approvedId: '8c9fd326-5aea-4207-8b5a-1601f2bc9d69',
  floorId: 'bdedd1da-0a03-442d-a58d-181877fe0652',
  materialId: 'cc0bfbc1-b1c8-4250-9014-dfdb6467b810',
  recording: '989659bd0b4e01e1cd80287e3c5932f2220cafa07485d6d1b1d23907dedcbce4',
  etag: '"studio-r224-9a650240993d0a7a211929bc2b3aa817f10a6c5565d0df5211d7c6d964d1bab3"',
};
const target = {
  floorId: '0037b5d8-040c-41e9-8c03-46d9d9cf50f7',
  materialId: 'fd4d34f8-82d2-4509-bdfd-216a174b406b',
  audioId: 'c86b2b4a-cc99-4fc9-b150-f5b17f05e44e',
};
const experience = 'org.exhibitos.viewer/experience', materials = 'org.exhibitos.studio/workspace-materials';
const indexName = 'static-publication-index.json', manifestName = 'static-export-manifest.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value));
const row = (path, bytes) => ({path, bytes: bytes.length, sha256: sha(bytes)});

async function pinned(path, hash) {
  assert.ok((await lstat(path)).isFile());
  const bytes = await readFile(path);
  assert.equal(sha(bytes), hash, path);
  return bytes;
}

function one(rows, key, value) {
  const matches = rows.filter(entry => entry[key] === value);
  assert.equal(matches.length, 1, `Expected one ${key}=${value}`);
  return matches[0];
}

function entrance(scene, floorId, materialId) {
  const floor = one(scene.surfaces, 'id', floorId);
  const room = one(scene.rooms, 'id', floor.roomId);
  assert.equal(floor.type, 'floor');
  assert.equal(room.name, '입구');
  const step = one(scene.extensions[experience].footsteps, 'surfaceId', floorId);
  assert.equal(step.material, 'stone');
  assert.equal(step.bank, undefined);
  const binding = one(scene.extensions[materials].bindings, 'surfaceId', floorId);
  const material = one(scene.extensions[materials].materials, 'id', materialId);
  assert.equal(binding.materialId, materialId);
  assert.equal(binding.materialVersion, 1);
  assert.equal(material.version, 1);
  return {floor, room, step, binding, material};
}

async function savedRecording(witness, priorPath) {
  const read = async (name, hash) => JSON.parse(await pinned(join(witness, name + '.json'), hash));
  const [prior, current, returned, validated, approved, saved, reopened, recording] = await Promise.all([
    pinned(priorPath, authority.priorJournal).then(bytes => JSON.parse(bytes)),
    read('authoring-return', authority.journal), read('return', authority.normalReturn),
    read('validated-audio', authority.validated), read('approved-audio', authority.approved),
    read('saved-exact', authority.save), read('reopened-exact', authority.reopen),
    pinned(join(witness, 'recording.wav'), authority.recording),
  ]);
  assert.equal(returned.stopped.journalSHA256, authority.journal);
  assert.equal(returned.stopped.portsClosed, true);
  assert.ok(Object.values(returned.stopped.childExits).every(code => code === 0));
  assert.equal(returned.exports, 0);
  assert.equal(current.revision, 644);
  assert.equal(current.savedEditVersion, 291);
  assert.equal(current.pending, null);
  assert.equal(current.etag, authority.etag);
  assert.equal(saved.sourceETag, prior.etag);
  assert.ok(isDeepStrictEqual({pending:null,...saved.document},current),'Saved document and journal differ');
  assert.ok(isDeepStrictEqual({pending:null,...reopened.document},current),'Reopened document and journal differ');
  assert.equal(approved.id, authority.approvedId);
  assert.equal(approved.state, 'approved');
  assert.equal(approved.revoked, false);
  assert.notEqual(validated.state, 'approved');
  assert.deepEqual(validated.mediaAsset, approved.mediaAsset);
  const media = approved.mediaAsset;
  assert.equal(media.sha256, authority.recording);
  assert.equal(media.bytes, recording.length);
  assert.equal(media.mime, 'audio/wav');
  assert.deepEqual(media.rights.permissions, {display: true, export: true, download: false, commercial: false});
  const scene = current.draft.candidate;
  assert.deepEqual(one(scene.mediaAssets, 'id', media.id), media);
  const inverse = structuredClone(scene);
  inverse.mediaAssets = inverse.mediaAssets.filter(entry => entry.id !== media.id);
  const {step} = entrance(inverse, authority.floorId, authority.materialId);
  assert.equal(step.assetId, media.id);
  delete step.assetId;
  assert.ok(isDeepStrictEqual(inverse,prior.draft.candidate),'Authoring inverse differs');
  return {scene, media, recording};
}

async function compose(sourceDir, receiptPath, projectionPath, witness, priorPath, destination) {
  for (const path of [sourceDir, receiptPath, projectionPath, witness, priorPath]) assert.equal(await realpath(path), path);
  assert.equal(resolve(destination), destination);
  assert.ok(![sourceDir, witness].some(path => destination.startsWith(path + sep) || path.startsWith(destination + sep)));
  const parent = dirname(destination), parentStat = await lstat(parent);
  assert.ok(parentStat.isDirectory() && parentStat.uid === process.getuid() && (parentStat.mode & 0o022) === 0);
  assert.equal(await realpath(parent), parent);
  const absent = () => lstat(destination).then(() => { throw Error('Output already exists'); }, error => {
    if (error.code !== 'ENOENT') throw error;
  });
  await absent();
  const [source, deployment, projection, saved] = await Promise.all([
    localStaticPublicationSource({...base, sourceDir}),
    pinned(receiptPath, base.deployment).then(bytes => JSON.parse(bytes)),
    pinned(projectionPath, base.projection).then(bytes => JSON.parse(bytes)),
    savedRecording(witness, priorPath),
  ]);
  assert.equal(deployment.artifactManifestSha256, base.sourceManifestSha256);
  assert.equal(deployment.buildId, base.viewerBuildId);
  assert.equal(deployment.trafficPercent, 100);
  assert.equal(projection.manifestSha256, base.sourceManifestSha256);
  assert.equal(projection.indexSha256, base.indexSha256);
  assert.equal(sha(await source.read('assets/AudioControls-BOajqsY4.js')), base.audioChunkSha256);
  const index = JSON.parse(await source.read(indexName));
  const oldBodyPath = `data/${base.bodySha256}.json`;
  assert.equal(index.publication.path, oldBodyPath);
  assert.equal(index.publication.sha256, base.bodySha256);
  const original = JSON.parse(await source.read(oldBodyPath));
  const exhibition = structuredClone(original.exhibition);
  const from = entrance(saved.scene, authority.floorId, authority.materialId);
  const to = entrance(exhibition, target.floorId, target.materialId);
  assert.equal(to.step.assetId, undefined);
  assert.deepEqual({...to.floor, id:from.floor.id, roomId:from.room.id}, from.floor);
  assert.deepEqual(to.room.dimensions, from.room.dimensions);
  assert.deepEqual(to.room.transform, from.room.transform);
  assert.deepEqual({...to.binding, surfaceId:from.floor.id, materialId:from.material.id}, from.binding);
  for (const key of ['kind','name','maps','rights']) assert.deepEqual(to.material[key], from.material[key]);
  const assetId = target.audioId;
  assert.ok(!exhibition.mediaAssets.some(entry => entry.id === assetId));
  assert.ok(!original.assets.some(entry => entry.assetId === assetId));
  to.step.assetId = assetId;
  exhibition.mediaAssets.push({...saved.media, id:assetId, path:`media/${assetId}/audio.wav`});
  assert.ok(validateViewerExperience(exhibition).valid);
  assert.ok(validateExhibition(exhibition, {publicationTime:original.publication.publishedAt}).valid);
  const inverse = structuredClone(exhibition);
  inverse.mediaAssets.pop();
  delete entrance(inverse, target.floorId, target.materialId).step.assetId;
  assert.deepEqual(inverse, original.exhibition);
  const revisionSha256 = revisionHash(exhibition);

  const audioPath = `data/${authority.recording}.bin`;
  const contentType = 'audio/wav';
  const asset = {assetId, url:`/api/v1/publications/${base.publicationId}/assets/${assetId}`, mime:contentType};
  const next = bindDerivedStaticCover(original, {
    ...original, exhibition, publication:{...original.publication, revisionSha256}, assets:[...original.assets, asset],
  });
  const body = json(next), bodySha256 = sha(body), bodyPath = `data/${bodySha256}.json`;
  const nextIndex = json({
    ...index, publication:{...index.publication,...row(bodyPath, body)},
    assets:[...index.assets,{assetId,...row(audioPath, saved.recording),mime:contentType}],
  });
  const indexSha256 = sha(nextIndex);
  const originalEntry = await source.read('index.html');
  assert.equal(sha(originalEntry), base.entrySha256);
  assert.deepEqual(await source.read('studio.html'), originalEntry);
  const html = originalEntry.toString('utf8');
  const pin = hash => `<meta name="exhibitos-static-index" content="${hash}">`;
  assert.equal(html.split(pin(base.indexSha256)).length, 2);
  const entry = Buffer.from(html.replace(pin(base.indexSha256), pin(indexSha256)));
  const noticePath = `audio-notices/${assetId}.txt`;
  const notice = Buffer.from([
    saved.media.rights.creditLine,
    `Recording SHA-256: ${authority.recording}`,
    'The approved asset permits display and export. Download and commercial use are disabled in the saved rights record.',
    '',
  ].join('\n'));
  const expected = new Map([...source.entries].filter(([path]) => ![oldBodyPath, indexName, 'index.html', 'studio.html'].includes(path)));
  assert.equal(expected.size, 173);
  const replacements = new Map([[bodyPath,body],[indexName,nextIndex],['index.html',entry],['studio.html',entry],[audioPath,saved.recording],[noticePath,notice]]);
  for (const [path, bytes] of replacements) {
    assert.ok(!expected.has(path));
    expected.set(path,row(path,bytes));
  }
  const files = [...expected.values()].sort((a,b) => a.path.localeCompare(b.path));
  const manifest = json({format:'exhibitos-static-publication-v1',publicationId:base.publicationId,revisionSha256,indexSha256,files});
  const manifestSha256 = sha(manifest);
  const stage = await mkdtemp(join(parent,'.entrance-playback-'));
  try {
    const output = join(stage,'output');
    await mkdir(output,{mode:0o700});
    for (const file of files) {
      const bytes = replacements.get(file.path) ?? await source.read(file.path);
      assert.deepEqual(row(file.path,bytes),file);
      const path = join(output,file.path);
      await mkdir(dirname(path),{recursive:true,mode:0o700});
      await writeFile(path,bytes,{mode:0o400,flag:'wx'});
    }
    await writeFile(join(output,manifestName),manifest,{mode:0o400,flag:'wx'});
    const replay = await localStaticPublicationSource({sourceDir:output,sourceManifestSha256:manifestSha256,indexSha256,revisionSha256,publicationId:base.publicationId});
    assert.deepEqual(replay.entries,expected);
    const result = {
      format:'exhibitos-r224-entrance-private-playback-v1', base, authority, target,
      result:{manifestSha256,indexSha256,bodySha256,entrySha256:sha(entry),revisionSha256,listedFiles:files.length},
      retainedFiles:173, notice:row(noticePath,notice), playbackObserved:false, nativeExport:false, publicReleaseAuthorized:false,
    };
    const custody = Buffer.from(JSON.stringify(result,null,2)+'\n');
    await writeFile(join(stage,'custody.json'),custody,{mode:0o400,flag:'wx'});
    const currentParent = await lstat(parent);
    assert.equal(currentParent.ino,parentStat.ino);
    assert.equal(currentParent.dev,parentStat.dev);
    await absent();
    await rename(stage,destination);
    return {...result,custodySha256:sha(custody)};
  } finally {
    await rm(stage,{recursive:true,force:true});
  }
}

if (import.meta.main) {
  const [source,receipt,projection,witness,prior,destination,...extra] = process.argv.slice(2);
  assert.ok(destination && !extra.length, 'Usage: compose-r224-entrance-playback.mjs SOURCE RECEIPT PROJECTION WITNESS PRIOR DESTINATION');
  console.log(JSON.stringify(await compose(source,receipt,projection,witness,prior,destination)));
}
