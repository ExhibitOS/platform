// SPDX-License-Identifier: AGPL-3.0-or-later
import sharp from 'sharp';
import {crc32} from 'node:zlib';

export const MAX_BENCH_PREPARATION_SOURCE_BYTES = 4 * 1024 * 1024;
const EDGE_LIMIT = 512;
const MAX_SOURCE_EDGE = 4096;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type View = { buffer: number; byteOffset?: number; byteLength: number; target?: number; byteStride?: number };
type BenchGlb = {
  extensions?: unknown; extensionsUsed?: unknown[]; extensionsRequired?: unknown[];
  buffers?: { byteLength: number; uri?: string }[];
  bufferViews?: View[];
  images?: { bufferView?: number; mimeType?: string; uri?: string; extensions?: unknown }[];
  textures?: { source?: number; extensions?: unknown }[];
  accessors?: { bufferView?: number; sparse?: { indices?: { bufferView?: number }; values?: { bufferView?: number } } }[];
  materials?: {
    extensions?: unknown; normalTexture?: unknown; occlusionTexture?: unknown; emissiveTexture?: unknown;
    pbrMetallicRoughness?: { baseColorTexture?: { index: number }; metallicRoughnessTexture?: unknown };
  }[];
};

function unsafe(): never { throw Error('BENCH_BASECOLOR_PREPARATION_UNSAFE'); }

function opaqueSrgbPng(png: Buffer, generated = false) {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) return unsafe();
  const chunks: Buffer[] = [PNG_SIGNATURE];
  let width = 0, height = 0, data = false, end = false, colour = false, density = false;
  for (let offset = 8; offset < png.length;) {
    if (end || png.length - offset < 12) return unsafe();
    const size = png.readUInt32BE(offset), next = offset + 12 + size;
    if (next > png.length) return unsafe();
    if (crc32(png.subarray(offset + 4, next - 4)) !== png.readUInt32BE(next - 4)) return unsafe();
    const tag = png.toString('ascii', offset + 4, offset + 8);
    if (tag === 'IHDR' && offset === 8 && size === 13) {
      width = png.readUInt32BE(offset + 8); height = png.readUInt32BE(offset + 12);
      if (width < 1 || height < 1 || width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE ||
          png[offset + 16] !== 8 || png[offset + 17] !== 2 || png[offset + 18] !== 0 ||
          png[offset + 19] !== 0 || png[offset + 20] !== 0) return unsafe();
    } else if (tag === 'sRGB' && width && !data && !colour && size === 1 && png[offset + 8]! <= 3) colour = true;
    else if (tag === 'pHYs' && generated && width && !data && !density && size === 9) density = true;
    else if (tag === 'IDAT' && width && size > 0) data = true;
    else if (tag === 'IEND' && data && size === 0) end = true;
    else return unsafe();
    if (generated && tag !== 'pHYs') chunks.push(png.subarray(offset, next));
    offset = next;
  }
  if (!end) return unsafe();
  return { width, height, bytes: generated ? Buffer.concat(chunks) : png };
}

/** Resize one opaque base-color image. Keep every non-image byte of the BIN
 * chunk and update only the image length, later byte offsets and GLB lengths. */
export async function prepareBenchBaseColor(source: Buffer): Promise<Buffer> {
  if (source.length < 28 || source.length > MAX_BENCH_PREPARATION_SOURCE_BYTES ||
      source.toString('ascii', 0, 4) !== 'glTF' || source.readUInt32LE(4) !== 2 ||
      source.readUInt32LE(8) !== source.length || source.readUInt32LE(16) !== 0x4e4f534a) return unsafe();
  const jsonEnd = 20 + source.readUInt32LE(12);
  if (jsonEnd % 4 || jsonEnd + 8 > source.length || source.readUInt32LE(jsonEnd + 4) !== 0x004e4942 ||
      source.readUInt32LE(jsonEnd) !== source.length - jsonEnd - 8) return unsafe();
  const doc = JSON.parse(source.toString('utf8', 20, jsonEnd)) as BenchGlb;
  const bin = source.subarray(jsonEnd + 8);
  if (!doc || doc.extensions !== undefined || doc.extensionsUsed?.length || doc.extensionsRequired?.length ||
      doc.buffers?.length !== 1 || doc.images?.length !== 1 || doc.textures?.length !== 1 ||
      !Array.isArray(doc.bufferViews) || !Array.isArray(doc.accessors) || !Array.isArray(doc.materials)) return unsafe();
  const [buffer] = doc.buffers, [image] = doc.images, [texture] = doc.textures;
  const viewIndex = image?.bufferView;
  if (!buffer || buffer.uri !== undefined || !Number.isSafeInteger(buffer.byteLength) ||
      buffer.byteLength > bin.length || buffer.byteLength < bin.length - 3 ||
      image?.mimeType !== 'image/png' || image.uri !== undefined || image.extensions !== undefined ||
      viewIndex === undefined || !Number.isSafeInteger(viewIndex) || viewIndex < 0 ||
      texture?.source !== 0 || texture.extensions !== undefined) return unsafe();
  if (!doc.materials.some(m => m.pbrMetallicRoughness?.baseColorTexture?.index === 0) ||
      doc.materials.some(m => m.extensions !== undefined || m.normalTexture !== undefined ||
        m.occlusionTexture !== undefined || m.emissiveTexture !== undefined ||
        m.pbrMetallicRoughness?.metallicRoughnessTexture !== undefined) ||
      doc.accessors.some(a => a.bufferView === viewIndex || a.sparse?.indices?.bufferView === viewIndex ||
        a.sparse?.values?.bufferView === viewIndex)) return unsafe();

  const imageView = doc.bufferViews[viewIndex];
  if (!imageView || imageView.target !== undefined || imageView.byteStride !== undefined) return unsafe();
  const imageStart = imageView.byteOffset ?? 0, imageEnd = imageStart + imageView.byteLength;
  for (const [index, view] of doc.bufferViews.entries()) {
    const start = view.byteOffset ?? 0, end = start + view.byteLength;
    if (view.buffer !== 0 || !Number.isSafeInteger(start) || start < 0 || start % 4 ||
        !Number.isSafeInteger(view.byteLength) || view.byteLength < 1 || end > buffer.byteLength ||
        (index !== viewIndex && start < imageEnd && end > imageStart)) return unsafe();
  }
  const imageBytes = bin.subarray(imageStart, imageEnd);
  const original = opaqueSrgbPng(imageBytes), edge = Math.max(original.width, original.height);
  if (edge <= EDGE_LIMIT) return unsafe();
  const width = Math.max(1, Math.round(original.width * EDGE_LIMIT / edge));
  const height = Math.max(1, Math.round(original.height * EDGE_LIMIT / edge));
  const encoded = await sharp(imageBytes, { failOn: 'warning', limitInputPixels: MAX_SOURCE_EDGE ** 2 })
    .toColourspace('srgb').resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const output = opaqueSrgbPng(encoded, true), png = output.bytes;
  if (output.width !== width || output.height !== height) return unsafe();

  // A multiple-of-four shift maintains alignment of every subsequent view.
  const shift = Math.ceil((png.length - imageView.byteLength) / 4) * 4;
  if (shift >= 0) return unsafe();
  imageView.byteLength = png.length;
  for (const view of doc.bufferViews) if ((view.byteOffset ?? 0) >= imageEnd) view.byteOffset = (view.byteOffset ?? 0) + shift;
  buffer.byteLength += shift;
  const updatedBin = Buffer.alloc(bin.length + shift);
  bin.copy(updatedBin, 0, 0, imageStart);
  png.copy(updatedBin, imageStart);
  bin.copy(updatedBin, imageEnd + shift, imageEnd);
  const json = Buffer.from(JSON.stringify(doc));
  const updatedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(updatedJson);
  const header = Buffer.from(source.subarray(0, 20)), binHeader = Buffer.from(source.subarray(jsonEnd, jsonEnd + 8));
  header.writeUInt32LE(28 + updatedJson.length + updatedBin.length, 8);
  header.writeUInt32LE(updatedJson.length, 12);
  binHeader.writeUInt32LE(updatedBin.length, 0);
  return Buffer.concat([header, updatedJson, binHeader, updatedBin]);
}
