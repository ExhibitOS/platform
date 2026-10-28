import {createHash} from 'node:crypto';
import {prepareTextureDerivative} from './approved-lod-pair.ts';
import {decodePngPixels as png,pngCrc as crc} from "./png-pixels.ts";
import {verifyBasisPayload} from './basis-payload.ts';
import {embeddedBasisPairs, ordinaryPngRoleSet, pbrTextureBinding, pbrTextureIsLinear} from '@exhibitos/studio-contract';
import { deflateSync } from "node:zlib";
import { validateBytes } from "gltf-validator";
import {normalizeDisplayWatermark} from '@exhibitos/studio-contract';
import {embeddedLabelMask} from './watermark-label.ts';
const LIMIT = 32 * 1024 * 1024;
let count = 0;
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  count += chunk.length;
  if (count > LIMIT) process.exit(1);
  chunks.push(chunk);
}
const bytes = Buffer.concat(chunks);
function fail(): never {
  throw Error("invalid format");
}
function closed(value: unknown, required: string[], optional: string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return required.every(k => Object.hasOwn(object, k)) && Object.keys(object).every(k => required.includes(k) || optional.includes(k));
}
async function embeddedPngProfile(doc: ReturnType<typeof JSON.parse>, data: Buffer, binHeader: number) {
  const ordinary=ordinaryPngRoleSet(doc), imageBytesLimit=8*1024*1024;
  const texturePixels = (ordinary?12:2)*1024*1024, textureBytes = (ordinary?24:8)*1024*1024;
  if (binHeader + 8 > data.length || binHeader % 4 || data.readUInt32LE(binHeader + 4) !== 0x004e4942 || data.readUInt32LE(binHeader) % 4 || binHeader + 8 + data.readUInt32LE(binHeader) !== data.length || !Array.isArray(doc.buffers) || doc.buffers.length !== 1 || !closed(doc.buffers[0], ["byteLength"]) || !Number.isSafeInteger(doc.buffers[0].byteLength) || doc.buffers[0].byteLength < 1 || doc.buffers[0].byteLength > data.length - binHeader - 8 || data.length - binHeader - 8 - doc.buffers[0].byteLength > 3) fail();
  if (!Array.isArray(doc.images) || doc.images.length < 1 || doc.images.length > 16 || !Array.isArray(doc.textures) || doc.textures.length < 1 || doc.textures.length > 8 || !(ordinary && doc.samplers===undefined) && (!Array.isArray(doc.samplers) || doc.samplers.length < 1 || doc.samplers.length > 8) || !Array.isArray(doc.bufferViews) || doc.animations !== undefined || doc.skins !== undefined) fail();
  const bin = data.subarray(binHeader + 8, binHeader + 8 + doc.buffers[0].byteLength);
  const integer = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
  const view = (index: unknown) => {
    if (!integer(index)) fail(); const v = doc.bufferViews[index];
    if (!v || v.buffer !== 0 || !integer(v.byteOffset ?? 0) || !integer(v.byteLength) || v.byteLength < 1 || (v.byteOffset ?? 0) + v.byteLength > bin.length) fail();
    return bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  };
  const basis=embeddedBasisPairs(doc,(i)=>view(doc.images[i].bufferView));
  let compressed = 0, pixels = 0;
  // Sum all image declarations before any expansion or third-party validator.
  const imageBytes: Buffer[] = [];
  for (const image of doc.images) {
    if (!closed(image, ["bufferView", "mimeType"], ["name"]) || !["image/png","image/ktx2"].includes(image.mimeType)) fail();
    const bytes = view(image.bufferView), v = doc.bufferViews[image.bufferView];
    if(image.mimeType==="image/ktx2"){if(!basis.has(doc.images.indexOf(image))||!closed(v,["buffer","byteLength"],["byteOffset","name"]))fail();compressed+=bytes.length;if(compressed>textureBytes)fail();await verifyBasisPayload(bytes);continue;}
    if (!closed(v, ["buffer", "byteLength"], ["byteOffset", "name"]) || bytes.length < 33 || bytes.length > imageBytesLimit || ordinary && (bytes[24]!==8 || bytes[25]!==2) || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii",12,16) !== "IHDR") fail();
    compressed += bytes.length; const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
    pixels += w * h;
    if (!w || !h || w > 2048 || h > 2048 || pixels > texturePixels || compressed > textureBytes) fail();
    imageBytes.push(bytes);
  }
  // The bounded ordinary role producer emits 16 KiB IDAT packets. An 8 MiB
  // image can exceed 256 chunks without increasing decoded pixels or bytes.
  // Keep legacy admission unchanged and retain all CRC/metadata/scanline checks.
  for (const bytes of imageBytes) png(bytes, ordinary?4*1024*1024:texturePixels, 2048, ordinary?1024:256);
  for (const sampler of doc.samplers??[]) {
    if(ordinary){
      if(!closed(sampler,[],["magFilter","minFilter","wrapS","wrapT","name"]) || sampler.magFilter!==undefined && ![9728,9729].includes(sampler.magFilter) || sampler.minFilter!==undefined && ![9728,9729,9984,9985,9986,9987].includes(sampler.minFilter) || [sampler.wrapS,sampler.wrapT].some(v=>v!==undefined && ![33071,10497,33648].includes(v)))fail();
      continue;
    }
    if (!closed(sampler,["magFilter","minFilter","wrapS","wrapT"],["name"]) || ![9728,9729].includes(sampler.magFilter) || sampler.minFilter !== 9729 || ![33071,10497,33648].includes(sampler.wrapS) || ![33071,10497,33648].includes(sampler.wrapT)) fail();
  }
  for (const t of doc.textures) if (!closed(t,ordinary?["source"]:["source","sampler"],ordinary?["sampler","name"]:["name","extensions"]) || !integer(t.source) || t.source >= doc.images.length || !(ordinary && t.sampler===undefined) && (!integer(t.sampler) || t.sampler >= (doc.samplers?.length??0))) fail();
  if (!Array.isArray(doc.materials) || doc.materials.length > 256) fail();
  const usedTextures = new Set<number>(), colourImages=new Set<number>(), linearImages=new Set<number>();
  for (const m of doc.materials) {
    if (!closed(m,[],["name","pbrMetallicRoughness","doubleSided","alphaMode","alphaCutoff","normalTexture","occlusionTexture"]) || m.pbrMetallicRoughness !== undefined && !closed(m.pbrMetallicRoughness,[],["baseColorTexture","baseColorFactor","metallicFactor","roughnessFactor","metallicRoughnessTexture"])) fail();
    for (const [t,role] of [[m.pbrMetallicRoughness?.baseColorTexture,'colour'],[m.normalTexture,'normal'],[m.occlusionTexture,'occlusion'],[m.pbrMetallicRoughness?.metallicRoughnessTexture,'metallicRoughness']] as const) {
      if (t === undefined) continue;
      const binding = pbrTextureBinding(t, role, doc.textures.length);
      usedTextures.add(binding.index);
      const texture=doc.textures[binding.index],source=texture.source,linear=pbrTextureIsLinear(role);
      if(linear && (doc.images[source].mimeType!=="image/png" || texture.extensions!==undefined))fail();
      (linear?linearImages:colourImages).add(source);
    }
  }
  if([...linearImages].some(i=>colourImages.has(i)))fail();
  if (usedTextures.size !== doc.textures.length) fail();
  const usedImages = new Set(doc.textures.map((t: {source: number}) => t.source));
  for(const index of basis.keys())usedImages.add(index);
  if (usedImages.size !== doc.images.length) fail();
  for (const mesh of doc.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    const material = doc.materials[primitive.material];
    if (!material?.pbrMetallicRoughness?.baseColorTexture && !material?.normalTexture && !material?.occlusionTexture && !material?.pbrMetallicRoughness?.metallicRoughnessTexture) continue;
    const a = doc.accessors?.[primitive.attributes?.TEXCOORD_0], position = doc.accessors?.[primitive.attributes?.POSITION];
    if (!a || a.type !== "VEC2" || a.componentType !== 5126 || a.normalized !== undefined || a.sparse !== undefined || !integer(a.count) || a.count < 1 || a.count > 131072 || a.count !== position?.count || !integer(a.byteOffset ?? 0)) fail();
    const bytes = view(a.bufferView), v = doc.bufferViews[a.bufferView], stride = v.byteStride ?? 8;
    if (!integer(stride) || stride < 8 || stride > 252 || stride % 4 || (a.byteOffset ?? 0) + (a.count - 1) * stride + 8 > bytes.length) fail();
    for (let i = 0; i < a.count; i++) for (let j = 0; j < 2; j++) {
      // UVs address normalized image size, but are not constrained to one tile.
      // Supported samplers above define clamp/repeat/mirror behavior. Preserve
      // authored values within the same finite magnitude cap as Processing.
      const x = bytes.readFloatLE((a.byteOffset ?? 0) + i * stride + j * 4); if (!Number.isFinite(x) || Math.abs(x) > 20000) fail();
    }
    // glTF can derive a tangent frame when absent. An authored frame must retain its exact handedness.
    if (primitive.attributes?.TANGENT !== undefined) {
      const t=doc.accessors?.[primitive.attributes.TANGENT];
      if (!integer(primitive.attributes.TANGENT) || !t || t.type!=="VEC4" || t.componentType!==5126 || t.normalized!==undefined || t.sparse!==undefined || t.count!==position.count || !integer(t.byteOffset??0)) fail();
      const tangent=view(t.bufferView), layout=doc.bufferViews[t.bufferView], step=layout.byteStride??16;
      if (!integer(step) || step<16 || step>252 || step%4 || (t.byteOffset??0)+(t.count-1)*step+16>tangent.length) fail();
      for(let i=0;i<t.count;i++)for(let j=0;j<4;j++) {
        const value=tangent.readFloatLE((t.byteOffset??0)+i*step+j*4);
        if(!Number.isFinite(value) || j===3 && value!==1 && value!==-1)fail();
      }
    }
  }
}
async function glb(data: Buffer) {
  if (
    data.length < 20 ||
    data.toString("ascii", 0, 4) !== "glTF" ||
    data.readUInt32LE(4) !== 2 ||
    data.readUInt32LE(8) !== data.length
  )
    fail();
  const jsonSize = data.readUInt32LE(12);
  if (
    jsonSize > 1024 * 1024 ||
    20 + jsonSize > data.length ||
    data.readUInt32LE(16) !== 0x4e4f534a
  )
    fail();
  const document = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      data.subarray(20, 20 + jsonSize),
    ),
  );
  // URI and extension rejection applies recursively, including nested extras.
  const scan = (v: unknown, depth = 0) => {
    if (depth > 64) fail();
    if (v && typeof v === "object") {
      if (Array.isArray(v)) {
        if (v.length > 100000) fail();
        for (const x of v) scan(x, depth + 1);
      } else for (const [k, x] of Object.entries(v)) {
        if (k === "uri" || k === "extensions" || k === "extensionsUsed" || k === "extensionsRequired" || depth > 0 && (k === "images" || k === "textures")) fail();
        scan(x, depth + 1);
      }
    }
  };
  const scanned = structuredClone(document); delete scanned.extensionsUsed; delete scanned.extensionsRequired;
  // The embedded profile independently validates each optional texture-local basis declaration.
  for(const texture of scanned.textures??[])delete texture.extensions;
  if(document.images===undefined&&document.textures===undefined&&((document.extensionsUsed?.length??0)||(document.extensionsRequired?.length??0)))fail();
  scan(scanned);
  if (document.images !== undefined || document.textures !== undefined)
    await embeddedPngProfile(document, data, 20 + jsonSize);
  const report = await validateBytes(data, {
    maxIssues: 64,
    externalResourceFunction: () =>
      Promise.reject(Error("external resource forbidden")),
  });
  if (report.issues.numErrors) fail();
}
function pngChunk(name: string, body: Buffer) {
  const header = Buffer.alloc(8),
    tail = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  header.write(name, 4);
  tail.writeUInt32BE(crc(Buffer.concat([header.subarray(4), body])));
  return Buffer.concat([header, body, tail]);
}
function markPng(data: Buffer,roleLimit?:512|256) {
  const limit=roleLimit??Number(process.argv[4]??512);
  if(!(roleLimit?[256,512]:[512,2048]).includes(limit))fail();
  const raw=roleLimit?undefined:process.argv[5];if(raw!==undefined&&raw.length>2048)fail();
  const watermark=normalizeDisplayWatermark(raw===undefined?undefined:JSON.parse(raw));
  const decoded = roleLimit?png(data,4194304,2048,1024):png(data),
    ratio = Math.min(1, limit/Math.max(decoded.width,decoded.height)),
    w = Math.max(1, (roleLimit?Math.floor:Math.round)(decoded.width*ratio)),
    h = Math.max(1, (roleLimit?Math.floor:Math.round)(decoded.height*ratio));
  if(watermark.mode!=='embedded'&&ratio===1)return data;
  const ink=watermark.mode==='embedded'?embeddedLabelMask(w,h,watermark):undefined;
  const channels=decoded.channels,out = Buffer.alloc((w * channels + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.floor(((roleLimit?x+.5:x) * decoded.width) / w),
        sy = Math.floor(((roleLimit?y+.5:y) * decoded.height) / h),
        src =
          sy * (decoded.width * decoded.channels + 1) +
          1 +
          sx * decoded.channels,
        index = y * (w * channels + 1) + 1 + x * channels;
      for (let n = 0; n < 3; n++) out[index + n] = decoded.pixels[src + n]!;
      if(channels===4)out[index + 3] = decoded.pixels[src + 3]!;
      if (ink?.(x,y)) {
        const alpha=watermark.opacity??.25,sourceAlpha=channels===4?out[index+3]!/255:1,resultAlpha=alpha+sourceAlpha*(1-alpha);
        for(let n=0;n<3;n++)out[index+n]=Math.round((32*alpha+out[index+n]!*sourceAlpha*(1-alpha))/resultAlpha);
        if(channels===4)out[index+3]=Math.round(resultAlpha*255);
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = channels===4?6:2;
  return Buffer.concat([
    data.subarray(0, 8),
    pngChunk("IHDR", header),
    ...(decoded.srgbIntent===undefined?[]:[pngChunk('sRGB',Buffer.from([decoded.srgbIntent]))]),
    pngChunk("IDAT", deflateSync(out)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
function checkDisplayModel(data: Buffer) {
  const size = data.readUInt32LE(12),
    doc = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        data.subarray(20, 20 + size),
      ),
    );
  if (
    doc.animations?.length ||
    doc.skins?.length ||
    doc.scenes?.length !== 1 ||
    (doc.scene ?? 0) !== 0 ||
    (doc.nodes?.length ?? 0) > 512
  )
    fail();
  const visited = new Set<number>(),
    usedMeshes = new Set<number>();
  const visit = (index: number, depth = 0) => {
    if (depth > 64 || visited.has(index) || !doc.nodes?.[index]) fail();
    visited.add(index);
    const node = doc.nodes[index];
    if (node.skin !== undefined || node.weights !== undefined) fail();
    if (node.mesh !== undefined) usedMeshes.add(node.mesh);
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  for (const root of doc.scenes[0].nodes ?? []) visit(root);
  if (
    visited.size !== doc.nodes.length ||
    usedMeshes.size !== (doc.meshes?.length ?? 0)
  )
    fail();
  for (const mesh of doc.meshes ?? []) {
    if (mesh.weights !== undefined) fail();
    for (const primitive of mesh.primitives ?? [])
      if (primitive.targets !== undefined) fail();
  }
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const n of doc.nodes ?? []) {
    if (
      (n.matrix && JSON.stringify(n.matrix) !== JSON.stringify(identity)) ||
      (n.translation && JSON.stringify(n.translation) !== "[0,0,0]") ||
      (n.rotation && JSON.stringify(n.rotation) !== "[0,0,0,1]") ||
      (n.scale && JSON.stringify(n.scale) !== "[1,1,1]")
    )
      fail();
  }
  let vertices = 0,
    indices = 0,
    draws = 0;
  for (const index of visited) {
    const node = doc.nodes[index];
    if (node.mesh === undefined) continue;
    for (const p of doc.meshes[node.mesh].primitives ?? []) {
      const accessor = doc.accessors?.[p.attributes?.POSITION];
      if (!accessor || !Number.isInteger(accessor.count) || accessor.count < 1)
        fail();
      vertices += accessor.count;
      indices +=
        p.indices === undefined
          ? accessor.count
          : (doc.accessors?.[p.indices]?.count ?? Infinity);
      draws++;
      if (vertices > 500000 || indices > 1500000 || draws > 256) fail();
    }
  }
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.meshes ?? []) {
    for (const p of mesh.primitives ?? []) {
      const a = doc.accessors?.[p.attributes?.POSITION];
      if (
        !a ||
        a.type !== "VEC3" ||
        !Array.isArray(a.min) ||
        !Array.isArray(a.max) ||
        a.min.length !== 3 ||
        a.max.length !== 3
      )
        fail();
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, a.min[i]);
        max[i] = Math.max(max[i]!, a.max[i]);
      }
    }
  }
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) fail();
  const span = Math.max(...max.map((x: number, i: number) => x - min[i]!));
  if (span <= 0) fail();
}

try {
  if(process.argv[3]==='texture-pair'){
    if(process.argv[2]!=='model/gltf-binary'||!process.argv[4]||process.argv[4].length>2048)fail();
    const binding=JSON.parse(process.argv[4]),hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
    if(binding.sourceSha256!==hash(bytes)||binding.settingsSha256!=='da9039b67435883255f723fd3b37b0fc395ba2acce3ab26706aeaa17d90f73bf'||binding.toolVersion!=='public-near-texture-v1')fail();
    await glb(bytes);checkDisplayModel(bytes);
    const result=prepareTextureDerivative(bytes,(image,edge)=>markPng(image,edge));await glb(result.bytes);
    const receipt=Buffer.from(JSON.stringify({version:1,toolName:'ExhibitOS validation-worker',toolVersion:'public-near-texture-v1',profileId:'exhibitos-near-texture-pair-v1',binding,full:{sha256:hash(bytes),bytes:bytes.length,reusedExactBytes:true,...result.metrics.full},reduced:{sha256:hash(result.bytes),bytes:result.bytes.length,...result.metrics.coarse},sampling:'nearest-centre-from-full',geometryChanged:false,normalRemapped:false,qualityApproved:false,requiresCurrentRegistration:true}));
    if(receipt.length>65536)fail();const header=Buffer.alloc(8);header.write('ETEX');header.writeUInt32LE(receipt.length,4);process.stdout.write(Buffer.concat([header,receipt,result.bytes]));
  } else if (process.argv[3] === "derivative") {
    if (process.argv[2] === "image/png") {
      process.stdout.write(markPng(bytes));
    } else if (process.argv[2] === "model/gltf-binary") {
      await glb(bytes);
      checkDisplayModel(bytes);
      // Validated clean GLB bytes keep geometry, material, UV, bounds and LOD.
      // Embedded model marking is not a supported capability.
      process.stdout.write(bytes);
    } else fail();
  } else if (process.argv[2] === "image/png") png(bytes);
  else if (process.argv[2] === "model/gltf-binary") await glb(bytes);
  else fail();
  if (!["derivative","texture-pair"].includes(process.argv[3]??"")) process.stdout.write("VALID\n");
} catch {
  process.exitCode = 1;
}
