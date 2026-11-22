// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {lstat, mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {copyNativeFurnishings, reviewedDefaultCatalogueReleasePlan} from './package-native-runtime.mjs';

const [source, destination, minimumManagerVersion, ...requiredCapabilities] = process.argv.slice(2);
if (!source || !destination || !minimumManagerVersion || !/^\d+\.\d+\.\d+$/.test(minimumManagerVersion) ||
    !requiredCapabilities.length || new Set(requiredCapabilities).size !== requiredCapabilities.length ||
    !requiredCapabilities.every(item => /^[a-z0-9-]{1,128}$/.test(item))) throw Error('DEFAULT_CATALOGUE_LAYOUT_ARGUMENTS');

const root = await realpath(resolve(source));
const {release, manifest, bytes, items} = await reviewedDefaultCatalogueReleasePlan(root);
if (manifest.bundleVersion==='1.22.0') {
  const expected = [
    'workspace-artwork-frame-models-v1', 'workspace-ceiling-rail-v1', 'source-bound-fit-v1',
    'workspace-portal-finish-v1', 'modular-portal-v1', 'default-seat-proposal-v1',
  ];
  if (minimumManagerVersion!=='0.1.0' || requiredCapabilities.length!==expected.length ||
      expected.some(capability=>!requiredCapabilities.includes(capability))) throw Error('DEFAULT_CATALOGUE_LAYOUT_COMPATIBILITY');
}
const output = resolve(destination);
await mkdir(output, {mode:0o700});
const packageRoot = join(output, 'packaged');
const attachments = join(output, 'attachments');
await mkdir(attachments, {mode:0o700});
await copyNativeFurnishings(root, packageRoot, release);
const digest = body => createHash('sha256').update(body).digest('hex');
const seen = new Map();
const inventory = [];
async function emit(name, body) {
  await writeFile(join(attachments, name), body, {flag:'wx',mode:0o400});
  inventory.push({name,bytes:body.length,sha256:digest(body)});
}
for (const {files} of items) {
  files.sort((left,right)=>left.path.localeCompare(right.path));
  for (const file of files) {
    const path = join(packageRoot, file.path);
    if (!(await lstat(path)).isFile() || await realpath(path)!==path) throw Error('DEFAULT_CATALOGUE_LAYOUT_FILE');
    const body = await readFile(path);
    if (body.length!==file.bytes || digest(body)!==file.sha256) throw Error('DEFAULT_CATALOGUE_LAYOUT_FILE');
    const length = seen.get(file.sha256);
    if (length !== undefined) {
      if (length!==file.bytes) throw Error('DEFAULT_CATALOGUE_LAYOUT_FILE');
      continue;
    }
    seen.set(file.sha256,file.bytes);
    await emit('catalogue-body-'+file.sha256, body);
  }
}
await emit('default-furnishings-manifest.json', bytes);
await emit('catalogue-release-v1.json', Buffer.from(JSON.stringify({
  schema:'org.exhibitos.default-catalogue-release/v1',
  bundleSchema:manifest.schema,bundleVersion:manifest.bundleVersion,
  minimumManagerVersion,requiredCapabilities,sourceCommit:release.commit,
  manifest:{bytes:bytes.length,sha256:release.manifestSHA256},items,
})+'\n'));
await writeFile(join(output,'attachment-inventory.json'),JSON.stringify(inventory.sort((a,b)=>a.name.localeCompare(b.name)),null,2)+'\n',{flag:'wx',mode:0o400});
