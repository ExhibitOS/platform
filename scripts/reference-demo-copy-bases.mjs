// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { revisionHash, validateExhibition } from '@exhibitos/spec';
import { spaceStillFor } from '@exhibitos/spec/space-still';
import { retainsCopyInventory, retainsCopyRights,retainedWheatCopyFiles } from '../apps/web/src/private-editor/previous-copy-compatibility.ts';
import { parseStaticJson } from '../apps/web/src/static-json.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const fail = () => { throw Error('DEMO_COPY_BASE'); };
const metaName = 'exhibitos-private-copy-bases';

export async function readApprovedCopyBases(config) {
  try {
    return JSON.parse(await readFile(config, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function requireRights(exhibition) {
  const still = spaceStillFor(exhibition);
  const sources = [...exhibition.artworks, ...exhibition.mediaAssets, ...(still ? [still] : [])];
  if (sources.some(item => item.rights.licenseId !== 'CC0-1.0' ||
      !item.rights.permissions.display || !item.rights.permissions.export) ||
      !validateExhibition(exhibition, { publicationTime: new Date().toISOString() }).valid) fail();
}

async function boundedFile(root, path, limit) {
  let dir = root;
  if ((await lstat(dir)).isSymbolicLink()) fail();
  for (const part of path.split('/')) {
    dir = join(dir, part);
    if ((await lstat(dir)).isSymbolicLink()) fail();
  }
  const file = join(root, path);
  const info = await lstat(file);
  if (!info.isFile() || info.size < 1 || info.size > limit) fail();
  return readFile(file);
}

export async function verifiedCopyBases({ output, archiveRoot, bases }) {
  if (!Array.isArray(bases) || bases.length > 16) fail();
  if (!bases.length) return [];
  const currentBytes = await boundedFile(output, 'static-publication-index.json', 1048576);
  const current = parseStaticJson(currentBytes);
  // Only the exact independently verified active Wheat v4 is admitted here.
  // Archived v4 copy bases remain unsupported below.
  if (current.version === 4) {
    const { verifiedQualifiedWheat } = await import('./qualified-wheat-reference.mjs');
    try { await verifiedQualifiedWheat({ root: output }); } catch { fail(); }
  }
  const readProjection = async (root, prefix, entry) => {
    if (!entry || !hex.test(entry.sha256) || entry.path !== `data/${entry.sha256}.json` ||
        entry.mime !== 'application/json' || !Number.isSafeInteger(entry.bytes)) fail();
    const data = await boundedFile(root, prefix + entry.path, 1048576);
    if (data.length !== entry.bytes || hash(data) !== entry.sha256) fail();
    return { data, projection: parseStaticJson(data) };
  };
  const { projection: active } = await readProjection(output, '', current.publication);
  requireRights(active.exhibition);
  const result = [], seen = new Set(), retained = new Map();
  for (const base of bases) {
    if (!base || Object.keys(base).sort().join(',') !== 'indexSha256,publicationId,revisionSha256' ||
        typeof base.publicationId !== 'string' || !uuid.test(base.publicationId) || typeof base.revisionSha256 !== 'string' || !hex.test(base.revisionSha256) ||
        typeof base.indexSha256 !== 'string' || !hex.test(base.indexSha256) || seen.has(base.indexSha256) || hash(currentBytes) === base.indexSha256) fail();
    seen.add(base.indexSha256);
    const prefix = `private-copy-bases/${base.indexSha256}/`;
    const indexPath = prefix + 'static-publication-index.json';
    const bytes = await boundedFile(archiveRoot, indexPath, 1048576);
    if (hash(bytes) !== base.indexSha256) fail();
    const index = parseStaticJson(bytes);
    if (index.version === 4) fail();
    const { data, projection } = await readProjection(archiveRoot, prefix, index.publication);
    if (projection.publication.id !== base.publicationId || projection.publication.status !== 'published' ||
        projection.publication.revisionSha256 !== base.revisionSha256 || revisionHash(projection.exhibition) !== base.revisionSha256 ||
        !retainsCopyRights(projection.exhibition,active.exhibition)) fail();
    requireRights(projection.exhibition);
    const supplemental=[];
    for(const file of retainedWheatCopyFiles(projection.exhibition,active.exhibition)){
      const same=entry=>entry.path===file.path&&entry.sha256===file.sha256&&entry.bytes===file.bytes&&entry.mime===file.mime;
      if(!index.assets.some(same)||current.assets.some(same))continue;
      let held;
      try{held=await boundedFile(output,file.path,file.bytes);}catch(error){if(error.code!=='ENOENT')throw error;held=await boundedFile(archiveRoot,'source/'+file.path,file.bytes);}
      if(held.length!==file.bytes||hash(held)!==file.sha256)fail();
      retained.set(file.path,held);supplemental.push(file);
    }
    if (!retainsCopyInventory(index,{...current,assets:[...current.assets,...supplemental]},current.version === 4)) fail();
    result.push([indexPath, bytes], [prefix + index.publication.path, data]);
  }
  return [...result,...retained];
}

function tag(bases) {
  return `<meta name="${metaName}" content='${JSON.stringify(bases)}'>`;
}

export async function writeCopyBases(output, archiveRoot, bases) {
  const files = await verifiedCopyBases({ output, archiveRoot, bases });
  if (!files.length) return;
  const studioPath = join(output, 'studio.html');
  const html = await readFile(studioPath, 'utf8');
  if (html.includes(metaName) || html.split('</head>').length !== 2) fail();
  for (const [path, bytes] of files) {
    await mkdir(dirname(join(output, path)), { recursive: true });
    try{await writeFile(join(output, path), bytes, { flag: 'wx' });}
    catch(error){if(error.code!=='EEXIST'||!path.startsWith('data/')||!(await boundedFile(output,path,bytes.length)).equals(bytes))throw error;}
  }
  const updated = Buffer.from(html.replace('</head>', tag(bases) + '</head>'));
  await writeFile(studioPath, updated);
  const manifestPath = join(output, 'static-export-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = (path, bytes) => ({ path, bytes: bytes.length, sha256: hash(bytes) });
  if (!manifest.files.some(row => row.path === 'studio.html')) fail();
  manifest.files = manifest.files.map(row => row.path === 'studio.html' ? entry('studio.html', updated) : row);
  for(const [path,bytes] of files){const present=manifest.files.find(row=>row.path===path);if(present){if(present.bytes!==bytes.length||present.sha256!==hash(bytes))fail();}else manifest.files.push(entry(path,bytes));}
  manifest.files.sort((a, b) => a.path.localeCompare(b.path));
  await writeFile(manifestPath, JSON.stringify(manifest));
}

export async function inspectCopyBases(output, bases, expected) {
  const files = await verifiedCopyBases({ output, archiveRoot: output, bases });
  const paths = new Set(files.map(([path]) => path).filter(path=>path.startsWith('private-copy-bases/')));
  const listed = [...expected.keys()].filter(path => path.startsWith('private-copy-bases/'));
  if (listed.length !== paths.size || listed.some(path => !paths.has(path))) fail();
  for(const [path,bytes] of files)if(path.startsWith('data/')){const entry=expected.get(path);if(!entry||entry.bytes!==bytes.length||entry.sha256!==hash(bytes))fail();}
  if (!expected.has('studio.html')) {
    if (paths.size) fail();
    return files.filter(([path])=>path.startsWith('data/')).map(([path])=>path.slice(5));
  }
  const studio = await readFile(join(output, 'studio.html'), 'utf8');
  const count = studio.split(metaName).length - 1;
  if (paths.size ? count !== 1 || !studio.includes(tag(bases)) : count !== 0) fail();
  return files.filter(([path])=>path.startsWith('data/')).map(([path])=>path.slice(5));
}
