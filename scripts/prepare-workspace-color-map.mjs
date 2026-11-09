// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { pngCrc } from '../apps/api/src/png-pixels.ts';
import { validateWorkspaceMaterialPng } from '../apps/api/src/workspace-material-png.ts';

const maxSourceBytes = 8 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const signature = Buffer.from('89504e470d0a1a0a', 'hex');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function readSource(path) {
  const source = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await source.stat()).isFile()) throw Error('COLOR_MAP_SOURCE_FILE');
    const bytes = Buffer.alloc(maxSourceBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await source.read(bytes, length, bytes.length - length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxSourceBytes) throw Error('COLOR_MAP_SOURCE_LIMIT');
    return bytes.subarray(0, length);
  } finally {
    await source.close();
  }
}

// Remove one C2PA manifest immediately after IHDR. The remaining chunks are
// copied byte for byte and must pass the ordinary material validator.
function withoutManifest(source) {
  const offset = 33;
  if (source.length < offset + 12 || !source.subarray(0, 8).equals(signature)
    || source.readUInt32BE(8) !== 13 || source.toString('ascii', 12, 16) !== 'IHDR'
    || source.toString('latin1', offset + 4, offset + 8) !== 'caBX') {
    throw Error('COLOR_MAP_MANIFEST_PROFILE');
  }
  const size = source.readUInt32BE(offset);
  const end = offset + size + 12;
  if (size < 1 || size > maxManifestBytes || end > source.length
    || pngCrc(source.subarray(offset + 4, end - 4)) !== source.readUInt32BE(end - 4)) {
    throw Error('COLOR_MAP_MANIFEST_PROFILE');
  }
  return Buffer.concat([source.subarray(0, offset), source.subarray(end)]);
}

const [sourcePath, expectedSha256, outputPath, ...extra] = process.argv.slice(2);
if (!sourcePath || !/^[a-f0-9]{64}$/.test(expectedSha256 ?? '') || !outputPath || extra.length) {
  throw Error('Usage: node scripts/prepare-workspace-color-map.mjs <original.png> <original-sha256> <new-color-map.png>');
}
const source = await readSource(sourcePath);
const sourceSha256 = sha256(source);
if (sourceSha256 !== expectedSha256) throw Error('COLOR_MAP_SOURCE_INTEGRITY');

const colorMap = withoutManifest(source);
const descriptor = {
  mime: 'image/png',
  bytes: colorMap.length,
  sha256: sha256(colorMap),
  width: colorMap.readUInt32BE(16),
  height: colorMap.readUInt32BE(20),
  colorSpace: 'srgb',
};
await validateWorkspaceMaterialPng('color', descriptor, colorMap);
await writeFile(outputPath, colorMap, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({
  recipe: 'workspace-color-map-remove-c2pa-v1',
  source: { sha256: sourceSha256, bytes: source.length },
  color: descriptor,
}));
