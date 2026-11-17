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
  textures?: { source?: number; sampler?: number; extensions?: unknown }[];
  samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[];
  accessors?: { bufferView?: number; sparse?: { indices?: { bufferView?: number }; values?: { bufferView?: number } } }[];
  materials?: {
    extensions?: unknown; normalTexture?: unknown; occlusionTexture?: unknown; emissiveTexture?: unknown;
    pbrMetallicRoughness?: { baseColorTexture?: { index: number }; metallicRoughnessTexture?: unknown };
  }[];
};

function unsafe(): never { throw Error('BENCH_BASECOLOR_PREPARATION_UNSAFE'); }

function opaqueSrgbPng(png: Buffer, mode?: 'generated' | 'legacy-source') {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) return unsafe();
  const chunks: Buffer[] = [PNG_SIGNATURE];
  const legacyMetadata = new Set<string>();
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
    else if (tag === 'pHYs' && mode === 'generated' && width && !data && !density && size === 9) density = true;
    else if (tag === 'IDAT' && width && size > 0) data = true;
    else if (tag === 'IEND' && data && size === 0) end = true;
    else if (mode === 'legacy-source' && width && !data && !legacyMetadata.has(tag)) {
      if (tag === 'gAMA' && size === 4 && png.readUInt32BE(offset + 8) === 45455 ||
          tag === 'cHRM' && size === 32 &&
          [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000].every((value, index) => png.readUInt32BE(offset + 8 + index * 4) === value) ||
          tag === 'eXIf' && size >= 8 && size <= 1024 ||
          (tag === 'oFFs' || tag === 'pHYs') && size === 9 && png[offset + 16]! <= 1) legacyMetadata.add(tag);
      else return unsafe();
    } else return unsafe();
    if (mode === 'legacy-source' && !legacyMetadata.has(tag) || mode === 'generated' && tag !== 'pHYs') chunks.push(png.subarray(offset, next));
    offset = next;
  }
  if (!end || mode === 'legacy-source' && !colour) return unsafe();
  return { width, height, bytes: mode ? Buffer.concat(chunks) : png };
}

async function resizeBaseColor(png: Buffer, width: number, height: number) {
  const edge = Math.max(width, height);
  const targetWidth = Math.max(1, Math.round(width * EDGE_LIMIT / edge));
  const targetHeight = Math.max(1, Math.round(height * EDGE_LIMIT / edge));
  const encoded = await sharp(png, { failOn: 'warning', limitInputPixels: MAX_SOURCE_EDGE ** 2 })
    .toColourspace('srgb').resize(targetWidth, targetHeight, { fit: 'fill', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const output = opaqueSrgbPng(encoded, 'generated');
  if (output.width !== targetWidth || output.height !== targetHeight) return unsafe();
  return output.bytes;
}

/** Resize one opaque base-color image. Keep every non-image byte of the BIN
 * chunk and update only the image length, later byte offsets and GLB lengths. */
export async function prepareBenchBaseColor(source: Buffer, legacySource = false): Promise<Buffer> {
  if (source.length < 28 || source.length > MAX_BENCH_PREPARATION_SOURCE_BYTES ||
      source.toString('ascii', 0, 4) !== 'glTF' || source.readUInt32LE(4) !== 2 ||
      source.readUInt32LE(8) !== source.length || source.readUInt32LE(16) !== 0x4e4f534a) return unsafe();
  const jsonEnd = 20 + source.readUInt32LE(12);
  if (jsonEnd % 4 || jsonEnd + 8 > source.length || source.readUInt32LE(jsonEnd + 4) !== 0x004e4942 ||
      source.readUInt32LE(jsonEnd) !== source.length - jsonEnd - 8) return unsafe();
  const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source.subarray(20, jsonEnd))) as BenchGlb;
  const bin = source.subarray(jsonEnd + 8);
  if (legacySource) return prepareLegacyBench(source, jsonEnd, doc, bin);
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
  const png = await resizeBaseColor(imageBytes, original.width, original.height);

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
  return preparedGlb(source, jsonEnd, doc, updatedBin);
}

/** Correct the bounded legacy two-base-color case after ordinary format
 * rejection. The caller must still strictly validate the resulting GLB. */
async function prepareLegacyBench(source: Buffer, jsonEnd: number, doc: BenchGlb, bin: Buffer): Promise<Buffer> {
  if (!doc || doc.extensions !== undefined || doc.extensionsUsed !== undefined || doc.extensionsRequired !== undefined ||
      doc.buffers?.length !== 1 || doc.images?.length !== 2 || doc.textures?.length !== 2 || doc.samplers?.length !== 1 ||
      !Array.isArray(doc.bufferViews) || !Array.isArray(doc.accessors) || !Array.isArray(doc.materials)) return unsafe();
  const [buffer] = doc.buffers, [sampler] = doc.samplers;
  if (!buffer || buffer.uri !== undefined || !Number.isSafeInteger(buffer.byteLength) ||
      buffer.byteLength > bin.length || buffer.byteLength < bin.length - 3 || !sampler ||
      sampler.magFilter !== 9729 || sampler.minFilter !== 9987 ||
      Object.keys(sampler).some(key => !['magFilter', 'minFilter', 'wrapS', 'wrapT'].includes(key)) ||
      [sampler.wrapS, sampler.wrapT].some(wrap => wrap !== undefined && ![33071, 10497, 33648].includes(wrap))) return unsafe();
  for (const [index, texture] of doc.textures.entries()) {
    if (!texture || texture.sampler !== 0 || texture.source !== index || texture.extensions !== undefined) return unsafe();
  }
  const usedTextures = new Set<number>();
  for (const material of doc.materials) {
    if (!material || material.extensions !== undefined || material.normalTexture !== undefined ||
        material.occlusionTexture !== undefined || material.emissiveTexture !== undefined ||
        material.pbrMetallicRoughness?.metallicRoughnessTexture !== undefined) return unsafe();
    const binding = material.pbrMetallicRoughness?.baseColorTexture;
    if (binding) {
      if (binding.index !== 0 && binding.index !== 1) return unsafe();
      usedTextures.add(binding.index);
    }
  }
  if (usedTextures.size !== 2) return unsafe();
  const imageIndices = new Set<number>();
  for (const image of doc.images) {
    if (image?.mimeType !== 'image/png' || image.uri !== undefined || image.extensions !== undefined ||
        image.bufferView === undefined || !Number.isSafeInteger(image.bufferView) || !doc.bufferViews[image.bufferView]) return unsafe();
    imageIndices.add(image.bufferView);
  }
  if (imageIndices.size !== 2 || doc.accessors.some(accessor =>
    [accessor?.bufferView, accessor?.sparse?.indices?.bufferView, accessor?.sparse?.values?.bufferView]
      .some(index => index !== undefined && imageIndices.has(index)))) return unsafe();
  const spans = doc.bufferViews.map((view, index) => {
    const start = view?.byteOffset ?? 0;
    if (!view || view.buffer !== 0 || !Number.isSafeInteger(start) || start < 0 ||
        !Number.isSafeInteger(view.byteLength) || view.byteLength < 1 || start + view.byteLength > buffer.byteLength) return unsafe();
    if (imageIndices.has(index) && (start % 4 || view.target !== undefined || view.byteStride !== undefined)) return unsafe();
    return { index, view, start, end: start + view.byteLength };
  });
  const images = spans.filter(span => imageIndices.has(span.index)).sort((a, b) => a.start - b.start);
  const pngs = images.map(image => {
    if (spans.some(span => span !== image && span.start < image.end && span.end > image.start)) return unsafe();
    return opaqueSrgbPng(bin.subarray(image.start, image.end), 'legacy-source');
  });
  if (pngs.some(png => png.width > 2048 || png.height > 2048) ||
      pngs.reduce((pixels, png) => pixels + png.width * png.height, 0) > 2 * 1024 * 1024 ||
      !pngs.some(png => Math.max(png.width, png.height) > EDGE_LIMIT)) return unsafe();
  const parts: Buffer[] = [];
  let cursor = 0, shift = 0;
  for (const [index, image] of images.entries()) {
    const png = pngs[index]!;
    const bytes = Math.max(png.width, png.height) > EDGE_LIMIT
      ? await resizeBaseColor(png.bytes, png.width, png.height) : png.bytes;
    const difference = Math.ceil((bytes.length - image.view.byteLength) / 4) * 4;
    if (difference > 0) return unsafe();
    parts.push(bin.subarray(cursor, image.start), bytes, Buffer.alloc(image.view.byteLength + difference - bytes.length));
    image.view.byteLength = bytes.length;
    for (const span of spans) {
      if (span.start >= image.end) span.view.byteOffset = (span.view.byteOffset ?? 0) + difference;
    }
    shift += difference;
    cursor = image.end;
  }
  parts.push(bin.subarray(cursor));
  buffer.byteLength += shift;
  sampler.minFilter = 9729;
  sampler.wrapS ??= 10497;
  sampler.wrapT ??= 10497;
  const result = preparedGlb(source, jsonEnd, doc, Buffer.concat(parts));
  if (result.length >= source.length) return unsafe();
  return result;
}

function preparedGlb(source: Buffer, jsonEnd: number, doc: BenchGlb, updatedBin: Buffer) {
  const json = Buffer.from(JSON.stringify(doc));
  const updatedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(updatedJson);
  const header = Buffer.from(source.subarray(0, 20)), binHeader = Buffer.from(source.subarray(jsonEnd, jsonEnd + 8));
  header.writeUInt32LE(28 + updatedJson.length + updatedBin.length, 8);
  header.writeUInt32LE(updatedJson.length, 12);
  binHeader.writeUInt32LE(updatedBin.length, 0);
  return Buffer.concat([header, updatedJson, binHeader, updatedBin]);
}
