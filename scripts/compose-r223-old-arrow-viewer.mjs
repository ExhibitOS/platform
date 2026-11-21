// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve, sep} from 'node:path';
import {revisionHash, validateExhibition} from '@exhibitos/spec';
import {validateSpaceLighting, validateStudioLightDetails, validateViewingPlan} from '@exhibitos/studio-contract';
import {bindDerivedStaticCover} from './derived-static-cover.mjs';
import {localStaticPublicationSource} from './local-static-publication-source.mjs';

const comparator = {
  publicationId: '63719dad-65d3-41e9-86a8-57304976e142',
  revisionSha256: '5f3d7db8466254fffc2f7fd55a17a4418262f8f0c0514d797dff0d8c36849929',
  sourceManifestSha256: 'c72ce3e2e3e5dda2b751b289652259d322f75f4c96e1351593ff2e49fed582f7',
  indexSha256: '68204787fd8330c83dc28ba14a11c211a72a41e57d08df061433de6c12efd725',
  bodySha256: '335d5923eed3af30a2d32c598fde28199d5e4be3a309f06e06b0457186935e28',
  entrySha256: '480df33de20c131a5c76b550bf096d690894c98f282adb66e8bc07acfcdc9cfe',
  custodySha256: 'bb82ba68b6c89e229ac90d7100b0ee5ce017c9041053837fa793a44c87919e8c',
  viewerBuildId: '561458b54f50c8ae6bac4320c0961d6bc858415c68230201d13184dbf617c192',
  viewerReceiptSha256: 'd204bd2b46aa6bdcd44ac6fde35d602ca40436ef10705240da457774d247c444',
};
const authoring = {
  beforeSha256: '5a1c49807d1a5f9798b825ef8ff07ca761a341fe4e871a3319f9b8d3172c938b',
  journalSha256: 'd2fa5367a663c0031f38178a624c7a53e37118557691f3ebf16bfc85d856aaf5',
  saveSha256: '8032b361d4264f795b18c6c72c39a93d04559ee4b52a6e04094981002ca773f2',
  reopenSha256: 'be05e378e3a7d60ec85f248a13a3ad2125af6bc9fe47a349e360ce30effdd85e',
  returnSha256: '759636c5ee0892e1a02a052d21bc940667992e380c71e04092e88f0b37f055dc',
  runtimeManifest: '3b35d0d81021b7118e7092c4406976307a0ec1d0ff0f58310a06b745f078dce1',
  stoppedGeneration: 'd79d7568-cd79-4c24-8499-9aea23a39feb',
  etag: '"studio-r223-8c84170602b6b08e2c8687028029c48d324f64b2f5f2ce321876de9a68f970bd"',
};
const native = {
  lightId: 'abb40218-43dc-4aa6-bf3f-04222598d4a4',
  placementId: 'c0bd428f-911a-418b-938e-1e98efb7ed4a',
};
const viewer = {
  lightId: '8d971324-da36-4a44-a6ea-205e5d2523cc',
  placementId: 'ded3877a-f5f8-4c44-9cd3-93fb40584ecb',
};
const modelSha256 = 'b9957bf0931550477e636ea64619f755e1056b124fb5f730dd8b6035c99d275c';
const detailsKey = 'org.exhibitos.studio/light-details';
const attachmentKey = 'org.exhibitos.studio/light-attachments';
const lightingKey = 'org.exhibitos.studio/space-lighting';
const indexName = 'static-publication-index.json';
const manifestName = 'static-export-manifest.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value));
const descriptor = (path, bytes) => ({path, bytes: bytes.length, sha256: sha(bytes)});

async function pinnedJson(path, expected) {
  assert.ok((await lstat(path)).isFile());
  const bytes = await readFile(path);
  assert.equal(sha(bytes), expected, path);
  return JSON.parse(bytes);
}

function find(rows, key, id) {
  const matching = rows.filter(item => item[key] === id);
  assert.equal(matching.length, 1, `Expected one ${key}: ${id}`);
  return matching[0];
}

function fixture(scene, {lightId, placementId}) {
  const light = find(scene.lights, 'id', lightId);
  const target = find(scene.placements, 'id', placementId);
  const art = find(scene.artworks, 'revisionId', target.artworkRevisionId);
  const room = find(scene.rooms, 'id', light.roomId);
  const details = find(scene.extensions[detailsKey].lights, 'lightId', lightId);
  const attachment = find(scene.extensions[attachmentKey].lights, 'lightId', lightId);
  assert.equal(light.targetPlacementId, target.id);
  assert.equal(target.roomId, room.id);
  assert.equal(room.name, '조각실');
  assert.equal(art.metadata.title, 'Old Arrow Maker');
  assert.equal(art.artworkType, 'sculpture');
  assert.equal(find(art.assets, 'id', target.assetId).sha256, modelSha256);
  return {light, target, room, details, attachment};
}

async function verifiedSave(witness) {
  const returned = await pinnedJson(join(witness, 'return.json'), authoring.returnSha256);
  const evidence = join(witness, 'fixed-gui-evidence');
  const [before, after, saved, reopened] = await Promise.all([
    pinnedJson(join(evidence, 'authoring-before.json'), authoring.beforeSha256),
    pinnedJson(join(evidence, 'authoring-return.json'), authoring.journalSha256),
    pinnedJson(join(evidence, 'saved-old-arrow.json'), authoring.saveSha256),
    pinnedJson(join(evidence, 'reopened-old-arrow.json'), authoring.reopenSha256),
  ]);
  assert.equal(returned.status, 'quit-complete');
  assert.equal(returned.stopped.journalSHA256, authoring.journalSha256);
  assert.equal(returned.stopped.runtimeManifest, authoring.runtimeManifest);
  assert.equal(returned.stopped.stoppedGeneration, authoring.stoppedGeneration);
  assert.equal(returned.stopped.portsClosed, true);
  assert.ok(Object.values(returned.stopped.childExits).every(code => code === 0));
  for (const [file, hash] of [['saved-old-arrow', authoring.saveSha256], ['reopened-old-arrow', authoring.reopenSha256]]) {
    assert.equal(returned.evidence[file], hash);
  }
  assert.equal(before.revision, 638);
  assert.equal(before.savedEditVersion, 289);
  assert.equal(saved.preconditionETag, before.etag);
  assert.equal(saved.document.revision, 641);
  assert.equal(saved.document.savedEditVersion, 290);
  assert.equal(saved.document.pending, null);
  assert.equal(saved.document.etag, authoring.etag);
  assert.equal(after.revision, 642);
  assert.equal(after.savedEditVersion, 290);
  assert.equal(after.etag, authoring.etag);
  assert.equal(after.pending, null);
  assert.deepEqual(reopened.document, after);
  assert.deepEqual(saved.document.draft, after.draft);

  const savedScene = after.draft.candidate;
  const inverse = structuredClone(savedScene);
  const {light} = fixture(inverse, native);
  assert.equal(light.castsShadow, true);
  light.castsShadow = false;
  assert.deepEqual(inverse, before.draft.candidate);
  return savedScene;
}

function shadowProjection(original, savedScene) {
  const source = fixture(savedScene, native);
  const target = fixture(original, viewer);
  assert.equal(target.light.castsShadow, false);
  assert.deepEqual({
    ...target.light,
    id: source.light.id, roomId: source.room.id,
    targetPlacementId: source.target.id, castsShadow: source.light.castsShadow,
  }, source.light);
  assert.deepEqual({...target.details, lightId: source.light.id}, source.details);
  assert.deepEqual(target.target.transform, source.target.transform);
  assert.deepEqual(target.room.transform, source.room.transform);
  assert.deepEqual(target.room.dimensions, source.room.dimensions);
  assert.deepEqual(target.attachment.anchor, source.attachment.anchor);
  assert.equal(target.attachment.gap, source.attachment.gap);
  assert.deepEqual(original.extensions[lightingKey], savedScene.extensions[lightingKey]);
  const closingProfile = find(original.extensions[detailsKey].lights, 'lightId', '5a8d5d00-5253-4856-bca5-31c2d391da09');
  assert.equal(closingProfile.angularProfile.kind, 'upper-framing');

  const next = structuredClone(original);
  const changed = find(next.lights, 'id', viewer.lightId);
  changed.castsShadow = source.light.castsShadow;
  const reverted = structuredClone(next);
  find(reverted.lights, 'id', viewer.lightId).castsShadow = false;
  assert.deepEqual(reverted, original);
  return next;
}

async function requireAbsent(path) {
  await lstat(path).then(() => { throw Error('Private output already exists'); }, error => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function compose(sourceDir, custodyPath, witness, destination) {
  for (const path of [sourceDir, custodyPath, witness]) assert.equal(await realpath(path), path);
  assert.equal(resolve(destination), destination);
  assert.ok(![sourceDir, witness].some(path => destination.startsWith(path + sep) || path.startsWith(destination + sep)));
  const parent = dirname(destination);
  const parentStat = await lstat(parent);
  assert.ok(parentStat.isDirectory() && parentStat.uid === process.getuid() && (parentStat.mode & 0o022) === 0);
  assert.equal(await realpath(parent), parent);
  await requireAbsent(destination);
  const [source, custody, savedScene] = await Promise.all([
    localStaticPublicationSource({...comparator, sourceDir}),
    pinnedJson(custodyPath, comparator.custodySha256),
    verifiedSave(witness),
  ]);
  assert.equal(custody.scope, 'base-light-only-private-observation');
  assert.equal(custody.candidate.manifestSha256, comparator.sourceManifestSha256);
  assert.equal(custody.viewer.buildId, comparator.viewerBuildId);
  assert.equal(custody.viewer.receiptSha256, comparator.viewerReceiptSha256);
  assert.equal(custody.publicReleaseAuthorized, false);
  assert.equal(source.entries.size, 161);
  const index = JSON.parse(await source.read(indexName));
  const oldBodyPath = `data/${comparator.bodySha256}.json`;
  assert.equal(index.publication.path, oldBodyPath);
  assert.equal(index.publication.sha256, comparator.bodySha256);
  assert.equal(find(index.assets, 'assetId', '6b369912-1749-4441-9ac1-ee77589d58ed').sha256, modelSha256);
  const original = JSON.parse(await source.read(oldBodyPath));
  const exhibition = shadowProjection(original.exhibition, savedScene);
  assert.equal(revisionHash(original.exhibition), comparator.revisionSha256);
  assert.ok(validateExhibition(exhibition, {publicationTime: original.publication.publishedAt}).valid);
  assert.ok(validateSpaceLighting(exhibition).valid && validateStudioLightDetails(exhibition).valid && validateViewingPlan(exhibition).valid);
  const revisionSha256 = revisionHash(exhibition);
  const bound = bindDerivedStaticCover(original, {
    ...original, publication: {...original.publication, revisionSha256}, exhibition,
  });
  assert.deepEqual({...bound, publication: original.publication, exhibition: original.exhibition, coverVariants: original.coverVariants}, original);
  const body = json(bound);
  const bodySha256 = sha(body);
  const bodyPath = `data/${bodySha256}.json`;
  const newIndex = json({...index, publication: {...index.publication, ...descriptor(bodyPath, body)}});
  const indexSha256 = sha(newIndex);

  const priorEntry = await source.read('index.html');
  assert.equal(sha(priorEntry), comparator.entrySha256);
  assert.deepEqual(await source.read('studio.html'), priorEntry);
  const html = priorEntry.toString('utf8');
  const meta = hash => `<meta name="exhibitos-static-index" content="${hash}">`;
  assert.equal(html.split(meta(comparator.indexSha256)).length, 2);
  assert.ok(html.includes(`<meta name="exhibitos-viewer-build-id" content="${comparator.viewerBuildId}">`));
  const entry = Buffer.from(html.replace(meta(comparator.indexSha256), meta(indexSha256)));
  const retained = new Map([...source.entries].filter(([path]) =>
    ![oldBodyPath, indexName, 'index.html', 'studio.html'].includes(path)));
  assert.equal(retained.size, 157);
  const replacements = new Map([[bodyPath, body], [indexName, newIndex], ['index.html', entry], ['studio.html', entry]]);
  const files = [...retained.values(), ...[...replacements].map(([path, bytes]) => descriptor(path, bytes))]
    .sort((left, right) => left.path.localeCompare(right.path));
  const manifest = json({
    format: 'exhibitos-static-publication-v1', publicationId: comparator.publicationId, revisionSha256, indexSha256, files,
  });
  const manifestSha256 = sha(manifest);
  const stage = await mkdtemp(join(parent, '.old-arrow-viewer-'));
  try {
    const output = join(stage, 'output');
    await mkdir(output, {mode: 0o700});
    for (const row of files) {
      const path = join(output, row.path);
      const bytes = replacements.get(row.path) ?? await source.read(row.path);
      assert.deepEqual(descriptor(row.path, bytes), row);
      await mkdir(dirname(path), {recursive: true, mode: 0o700});
      await writeFile(path, bytes, {flag: 'wx', mode: 0o400});
    }
    await writeFile(join(output, manifestName), manifest, {flag: 'wx', mode: 0o400});
    await localStaticPublicationSource({
      sourceDir: output, sourceManifestSha256: manifestSha256, indexSha256, revisionSha256, publicationId: comparator.publicationId,
    });
    const receipt = {
      format: 'exhibitos-r223-old-arrow-private-custody-v1',
      scope: 'old-arrow-shadow-and-closing-fallback-private-observation',
      comparator, authoring, mapping: {native, viewer, modelSha256},
      candidate: {manifestSha256, indexSha256, bodySha256, entrySha256: sha(entry), revisionSha256, listedFiles: files.length},
      retainedFiles: retained.size, closingLightProfilePreserved: true,
      appearanceHold162: true, nativeExportPerformed: false, publicReleaseAuthorized: false,
    };
    const receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
    await writeFile(join(stage, 'custody.json'), receiptBytes, {flag: 'wx', mode: 0o400});
    const currentParent = await lstat(parent);
    assert.ok(currentParent.dev === parentStat.dev && currentParent.ino === parentStat.ino);
    assert.equal(await realpath(parent), parent);
    await requireAbsent(destination);
    await rename(stage, destination);
    return {...receipt, custodySha256: sha(receiptBytes)};
  } finally {
    await rm(stage, {recursive: true, force: true});
  }
}

if (import.meta.main) {
  const [source, custody, witness, destination, ...extra] = process.argv.slice(2);
  assert.ok(destination && !extra.length, 'Usage: compose-r223-old-arrow-viewer.mjs PRIVATE_SOURCE CUSTODY WITNESS DESTINATION');
  console.log(JSON.stringify(await compose(source, custody, witness, destination)));
}
