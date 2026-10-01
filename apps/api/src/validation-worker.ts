import { deflateSync, inflateSync } from "node:zlib";
import { validateBytes } from "gltf-validator";
const LIMIT = 32 * 1024 * 1024,
  PIXELS = 4 * 1024 * 1024;
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
function crc(data: Buffer) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let i = 0; i < 8; i++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function png(data: Buffer) {
  if (
    data.length < 33 ||
    !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    fail();
  let offset = 8,
    width = 0,
    height = 0,
    channels = 0,
    ended = false,
    seenIdat = false,
    closedIdat = false;
  const compressed: Buffer[] = [];
  let chunkCount = 0;
  while (offset < data.length) {
    if (++chunkCount > 256 || offset + 12 > data.length) fail();
    const size = data.readUInt32BE(offset),
      end = offset + 12 + size;
    if (end > data.length) fail();
    const kind = data.toString("latin1", offset + 4, offset + 8);
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(kind)) fail();
    const body = data.subarray(offset + 8, end - 4);
    if (crc(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4))
      fail();
    if (offset === 8) {
      if (kind !== "IHDR" || size !== 13) fail();
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = body[9] === 2 ? 3 : body[9] === 6 ? 4 : 0;
      if (
        !width ||
        !height ||
        width * height > PIXELS ||
        width > 8192 ||
        height > 8192 ||
        body[8] !== 8 ||
        !channels ||
        body[10] !== 0 ||
        body[11] !== 0 ||
        body[12] !== 0
      )
        fail();
    } else if (kind === "IDAT") {
      if (closedIdat) fail();
      seenIdat = true;
      compressed.push(body);
    } else if (kind === "IEND") {
      if (size !== 0 || !seenIdat || end !== data.length) fail();
      ended = true;
    } else {
      if (seenIdat) closedIdat = true;
      /* Conservative profile rejects all ancillary metadata and unknown critical chunks. */ fail();
    }
    offset = end;
  }
  if (!ended) fail();
  const expanded = (width * channels + 1) * height;
  const result = inflateSync(Buffer.concat(compressed), {
    maxOutputLength: expanded,
    info: true,
  }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
  if (
    result.buffer.length !== expanded ||
    result.engine.bytesWritten !== Buffer.concat(compressed).length
  )
    fail();
  // Validate and reconstruct every scanline, including Paeth dependencies.
  const stride = width * channels,
    rowBytes = stride + 1;
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const start = y * rowBytes,
      type = result.buffer[start]!;
    if (type > 4) fail();
    for (let x = 0; x < stride; x++) {
      const index = start + 1 + x,
        a = x >= channels ? result.buffer[index - channels]! : 0,
        b = y ? result.buffer[index - rowBytes]! : 0,
        c =
          y && x >= channels ? result.buffer[index - rowBytes - channels]! : 0;
      const add =
        type === 0
          ? 0
          : type === 1
            ? a
            : type === 2
              ? b
              : type === 3
                ? Math.floor((a + b) / 2)
                : paeth(a, b, c);
      result.buffer[index] = (result.buffer[index]! + add) & 255;
    }
  }
  return { pixels: result.buffer, width, height, channels };
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
  // No extensions, embedded images or URI fetches in this first qualified profile.
  if (document.extensionsUsed?.length || document.extensionsRequired?.length)
    fail();
  const scan = (v: unknown, depth = 0) => {
    if (depth > 64) fail();
    if (v && typeof v === "object") {
      if (Array.isArray(v)) {
        if (v.length > 100000) fail();
        for (const x of v) scan(x, depth + 1);
      } else
        for (const [k, x] of Object.entries(v)) {
          if (
            k === "uri" ||
            k === "extensions" ||
            k === "images" ||
            k === "textures"
          )
            fail();
          scan(x, depth + 1);
        }
    }
  };
  scan(document);
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
function markPng(data: Buffer) {
  const decoded = png(data),
    w = Math.min(512, decoded.width),
    h = Math.max(1, Math.round((decoded.height * w) / decoded.width)),
    out = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.floor((x * decoded.width) / w),
        sy = Math.floor((y * decoded.height) / h),
        src =
          sy * (decoded.width * decoded.channels + 1) +
          1 +
          sx * decoded.channels,
        index = y * (w * 4 + 1) + 1 + x * 4;
      for (let n = 0; n < 3; n++) out[index + n] = decoded.pixels[src + n]!;
      out[index + 3] = decoded.channels === 4 ? decoded.pixels[src + 3]! : 255;
      // Visible diagonal display-copy stripes; source bytes are never changed.
      if ((x + y) % 32 < 6) {
        out[index] = Math.round(out[index]! * 0.35 + 220 * 0.65);
        out[index + 1] = Math.round(out[index + 1]! * 0.35);
        out[index + 2] = Math.round(out[index + 2]! * 0.35);
        out[index + 3] = 255;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    data.subarray(0, 8),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(out)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
function markGlb(data: Buffer) {
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
  const positions: number[] = [];
  const quad = (
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
  ) =>
    positions.push(
      x,
      y,
      z,
      x + width,
      y,
      z,
      x,
      y + height,
      z,
      x,
      y + height,
      z,
      x + width,
      y,
      z,
      x + width,
      y + height,
      z,
    );
  // Three opaque red geometry stripes across model bounds, visibly distinct display derivative.
  const w = max[0]! - min[0]! || span,
    h = max[1]! - min[1]! || span,
    z = max[2]! + span * 0.02;
  for (let i = 1; i <= 3; i++)
    quad(min[0]!, min[1]! + (h * i) / 4, z, w, h * 0.025);
  const originalBinStart = 20 + size,
    originalBin =
      originalBinStart < data.length
        ? data.subarray(originalBinStart + 8)
        : Buffer.alloc(0),
    offset = Math.ceil(originalBin.length / 4) * 4,
    extra = Buffer.alloc(positions.length * 4);
  positions.forEach((x, i) => extra.writeFloatLE(x, i * 4));
  const bin = Buffer.concat([
    originalBin,
    Buffer.alloc(offset - originalBin.length),
    extra,
  ]);
  const vi = (doc.bufferViews ??= []).length;
  doc.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: extra.length,
    target: 34962,
  });
  const ai = (doc.accessors ??= []).length;
  doc.accessors.push({
    bufferView: vi,
    componentType: 5126,
    count: positions.length / 3,
    type: "VEC3",
    min: [min[0], min[1]! + h / 4, z],
    max: [min[0]! + w, min[1]! + (h * 3) / 4 + h * 0.025, z],
  });
  const mi = (doc.materials ??= []).length;
  doc.materials.push({
    name: "ExhibitOS display watermark",
    pbrMetallicRoughness: {
      baseColorFactor: [0.9, 0.05, 0.05, 1],
      metallicFactor: 0,
      roughnessFactor: 1,
    },
    doubleSided: true,
  });
  const mesh = (doc.meshes ??= []).length;
  doc.meshes.push({
    name: "DISPLAY COPY watermark",
    primitives: [{ attributes: { POSITION: ai }, material: mi, mode: 4 }],
  });
  const node = (doc.nodes ??= []).length;
  doc.nodes.push({ name: "ExhibitOS display copy watermark", mesh });
  for (const scene of doc.scenes ?? []) (scene.nodes ??= []).push(node);
  doc.asset.extras = {
    exhibitos: {
      watermarked: true,
      policy: "display-copy",
      label: "ExhibitOS display copy",
    },
  };
  doc.buffers = [{ byteLength: bin.length }];
  const json = Buffer.from(JSON.stringify(doc)),
    padded = Buffer.concat([
      json,
      Buffer.alloc((4 - (json.length % 4)) % 4, 32),
    ]),
    header = Buffer.alloc(20),
    bh = Buffer.alloc(8);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + bin.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, padded, bh, bin]);
}
try {
  if (process.argv[3] === "derivative") {
    if (process.argv[2] === "image/png") {
      process.stdout.write(markPng(bytes));
    } else if (process.argv[2] === "model/gltf-binary") {
      await glb(bytes);
      const output = markGlb(bytes);
      await glb(output);
      process.stdout.write(output);
    } else fail();
  } else if (process.argv[2] === "image/png") png(bytes);
  else if (process.argv[2] === "model/gltf-binary") await glb(bytes);
  else fail();
  if (process.argv[3] !== "derivative") process.stdout.write("VALID\n");
} catch {
  process.exitCode = 1;
}
