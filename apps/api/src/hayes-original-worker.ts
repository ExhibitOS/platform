// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {crc32} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fstatSync} from 'node:fs';
import {Socket} from 'node:net';
import {setImmediate} from 'node:timers/promises';

const lockIdentity = process.argv[4];
const nonce = process.argv[5];
if (!nonce || !/^[0-9a-f]{32}$/.test(nonce)) process.exit(70);
const expectedGo = `GO ${nonce}\n`;
function assertLock() {
  try {
    const stat = fstatSync(4, {bigint: true});
    if (stat.isFile() && `${stat.dev}:${stat.ino}` === lockIdentity) return;
  } catch { /* Invalid or closed inherited descriptor. */ }
  process.exit(71);
}

// The trusted owner supplies a locked open description. fstat checks only
// descriptor presence and file identity. This worker never unlocks or closes it.
assertLock();
const owner = new Socket({fd: 3, readable: true, writable: true});
const exitOwnerLost = () => process.exit(70);
owner.once('end', exitOwnerLost);
owner.once('error', exitOwnerLost);
const deadline = setTimeout(exitOwnerLost, 11000);

async function awaitGo() {
  await new Promise<void>(resolve => {
    let command = '';
    owner.on('data', (chunk: Buffer) => {
      command += chunk.toString('latin1');
      if (!expectedGo.startsWith(command)) exitOwnerLost();
      if (command === expectedGo) resolve();
    });
    owner.write(`READY ${nonce}\n`);
  });
  assertLock();
}

const sourceLength = 8383096;
const vertexCount = 86202;
const edge = 2048;
const targetIndices = 300000;
const errorLimit = 0.005;
type View = {byteOffset?: number; byteLength: number};

function pad(bytes: Buffer, fill = 0): Buffer {
  return Buffer.concat([bytes, Buffer.alloc((4 - bytes.length % 4) % 4, fill)]);
}

function ordinaryPng(png: Buffer, colour: boolean): Buffer {
  const chunks = [png.subarray(0, 8)];
  let offset = 8;
  while (offset < png.length) {
    const end = offset + 12 + png.readUInt32BE(offset);
    assert(end <= png.length);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR' || type === 'IDAT' || type === 'IEND') {
      chunks.push(png.subarray(offset, end));
    }
    if (type === 'IHDR' && colour) {
      const chunk = Buffer.alloc(13);
      chunk.writeUInt32BE(1);
      chunk.write('sRGB', 4);
      chunk.writeUInt32BE(crc32(chunk.subarray(4, 9)), 9);
      chunks.push(chunk);
    }
    offset = end;
  }
  return Buffer.concat(chunks);
}

async function texture(sharp: typeof import("sharp")["default"], jpeg: Buffer, index: number): Promise<Buffer> {
  const image = sharp(jpeg, {limitInputPixels: 4096 ** 2, failOn: 'warning', ignoreIcc: true});
  const metadata = await image.metadata();
  assert(metadata.format === 'jpeg' && metadata.width === 4096 && metadata.height === 4096);
  assert(metadata.channels === (index === 1 ? 1 : 3) && !metadata.icc);
  const decoded = await image.toColourspace(index === 1 ? 'b-w' : 'srgb').raw().toBuffer({resolveWithObject: true});
  const channels = decoded.info.channels;
  assert(channels === (index === 1 ? 1 : 3) && decoded.data.length === 4096 ** 2 * channels);
  const samples = Buffer.alloc(edge * edge * 3);
  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      const source = ((y * 2 + 1) * 4096 + x * 2 + 1) * channels;
      const target = (y * edge + x) * 3;
      samples[target] = decoded.data[source]!;
      samples[target + 1] = decoded.data[source + (channels === 3 ? 1 : 0)]!;
      samples[target + 2] = decoded.data[source + (channels === 3 ? 2 : 0)]!;
    }
  }
  const png = await sharp(samples, {raw: {width: edge, height: edge, channels: 3}}).png({adaptiveFiltering: true}).toBuffer();
  return ordinaryPng(png, index === 0);
}

function reduce(simplifier: typeof import("meshoptimizer")["MeshoptSimplifier"], views: Buffer[]) {
  const floats = (bytes: Buffer) => new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  const positions = floats(views[0]!);
  const normals = floats(views[1]!);
  const uv = floats(views[2]!);
  const index = views[3]!;
  const indices = new Uint32Array(index.buffer, index.byteOffset, 450000);
  const attributes = new Float32Array(vertexCount * 5);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    attributes.set(normals.subarray(vertex * 3, vertex * 3 + 3), vertex * 5);
    attributes.set(uv.subarray(vertex * 2, vertex * 2 + 2), vertex * 5 + 3);
  }

  const referenced = new Set(indices);
  const locks = new Uint8Array(vertexCount);
  for (let axis = 0; axis < 3; axis++) {
    let min = indices[0]!;
    let max = min;
    for (const vertex of referenced) {
      const value = positions[vertex * 3 + axis]!;
      if (value < positions[min * 3 + axis]!) min = vertex;
      if (value > positions[max * 3 + axis]!) max = vertex;
    }
    locks[min] = 1;
    locks[max] = 1;
  }

  const [reduced, error] = simplifier.simplifyWithAttributes(
    indices, positions, 3, attributes, 5, [0.5, 0.5, 0.5, 1, 1], locks,
    targetIndices, errorLimit, ['LockBorder'],
  );
  assert(reduced.length > 0 && reduced.length <= targetIndices && reduced.length % 3 === 0);
  assert(Number.isFinite(error) && error >= 0 && error <= errorLimit);
  const retained = new Set(reduced);
  assert([...retained].every(vertex => referenced.has(vertex)));
  assert(locks.every((locked, vertex) => !locked || retained.has(vertex)));
  for (let i = 0; i < reduced.length; i += 3) {
    const [a, b, c] = reduced.subarray(i, i + 3);
    assert(a !== b && a !== c && b !== c);
  }
  return {indices: Buffer.from(reduced.buffer, reduced.byteOffset, reduced.byteLength), error};
}

async function run() {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const bytes = chunk as Buffer;
    length += bytes.length;
    assert(length <= sourceLength);
    chunks.push(bytes);
  }
  await setImmediate();
  assert(length === sourceLength);
  const source = Buffer.concat(chunks, length);
  chunks.length = 0;
  assert(createHash('sha256').update(source).digest('hex') ===
    'e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6');
  assert(source.toString('ascii', 0, 4) === 'glTF' && source.readUInt32LE(4) === 2);
  assert(source.readUInt32LE(8) === length && source.toString('ascii', 16, 20) === 'JSON');
  const headerEnd = 20 + source.readUInt32LE(12);
  assert(source.readUInt32LE(headerEnd) === length - headerEnd - 8);
  assert(source.readUInt32LE(headerEnd + 4) === 0x004e4942);
  const document = JSON.parse(source.toString('utf8', 20, headerEnd));
  const body = source.subarray(headerEnd + 8);
  const views: View[] = document.bufferViews;
  assert(views.length === 7 && document.images.length === 3);
  const data: Buffer[] = views.map(({byteOffset = 0, byteLength}) => {
    assert(byteOffset >= 0 && byteLength > 0 && byteOffset + byteLength <= body.length);
    return body.subarray(byteOffset, byteOffset + byteLength);
  });
  const {MeshoptSimplifier} = await import('meshoptimizer');
  await MeshoptSimplifier.ready;
  const {default: sharp} = await import('sharp');
  assert(sharp.versions.sharp === '0.35.4' && sharp.versions.vips === '8.18.6' && sharp.versions.mozjpeg === '0826579');
  sharp.cache(false);
  sharp.concurrency(1);
  const reduced = reduce(MeshoptSimplifier, data);
  data[3] = reduced.indices;
  const triangles = reduced.indices.length / 12;
  document.accessors[3].count = triangles * 3;
  for (let i = 0; i < 3; i++) {
    const image = document.images[i];
    assert(image.bufferView === i + 4 && image.mimeType === 'image/jpeg');
    data[i + 4] = await texture(sharp, data[i + 4]!, i);
    image.mimeType = 'image/png';
  }
  let offset = 0;
  const payload = data.map((bytes, index) => {
    const view = views[index]!;
    if (index) view.byteOffset = offset;
    view.byteLength = bytes.length;
    const padded = pad(bytes);
    offset += padded.length;
    return padded;
  });
  document.buffers[0].byteLength = offset;
  const json = pad(Buffer.from(JSON.stringify(document)), 32);
  const header = Buffer.alloc(28);
  header.writeFloatLE(reduced.error);
  header.writeUInt32LE(process.resourceUsage().maxRSS, 4);
  header.write('glTF', 8);
  header.writeUInt32LE(2, 12);
  header.writeUInt32LE(28 + json.length + offset, 16);
  header.writeUInt32LE(json.length, 20);
  header.write('JSON', 24);
  const bin = Buffer.alloc(8);
  bin.writeUInt32LE(offset);
  bin.writeUInt32LE(0x004e4942, 4);
  await setImmediate();
  assertLock();
  process.stdout.write(Buffer.concat([header, json, bin, ...payload]));
}

try {
  await awaitGo();
  await setImmediate();
  assertLock();
  if (process.argv[3] === 'generate') await run();
  else if (process.argv[3] === 'validate') {
    // The strict worker uses argv[3] to select optional operations.
    process.argv.length = 3;
    await import('./validation-worker.ts');
    assertLock();
    if (!process.exitCode) process.stdout.write(`RSS ${process.resourceUsage().maxRSS}\n`);
  } else process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  owner.destroy();
}
