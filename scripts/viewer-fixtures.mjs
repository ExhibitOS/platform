// SPDX-License-Identifier: AGPL-3.0-or-later
// Original deterministic synthetic geometry/pixels, independent of Capture.
import { deflateSync } from "node:zlib";
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let n = 0; n < 8; n++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const tag = Buffer.from(type),
    out = Buffer.alloc(bytes.length + 12);
  out.writeUInt32BE(bytes.length);
  tag.copy(out, 4);
  bytes.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([tag, bytes])), bytes.length + 8);
  return out;
}
export function syntheticPng(size = 2048) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(size * (size * 3 + 1));
  const colors = [
    [230, 80, 40],
    [255, 195, 40],
    [35, 120, 145],
    [235, 225, 205],
  ];
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      const color =
        colors[(Math.floor(x / (size / 8)) + Math.floor(y / (size / 8))) % 4];
      const stripe = ((x * 13 + y * 7) % 29) - 14;
      for (let i = 0; i < 3; i++)
        pixels[row + 1 + x * 3 + i] = Math.min(
          255,
          Math.max(0, color[i] + stripe),
        );
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export function denseCubeGlb(grid = 48) {
  const positions = [],
    normals = [],
    indices = [];
  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  for (const { n, u, v } of faces) {
    const offset = positions.length / 3;
    for (let y = 0; y <= grid; y++)
      for (let x = 0; x <= grid; x++) {
        for (let i = 0; i < 3; i++)
          positions.push(
            n[i] * 0.5 + u[i] * (x / grid - 0.5) + v[i] * (y / grid - 0.5),
          );
        normals.push(...n);
      }
    for (let y = 0; y < grid; y++)
      for (let x = 0; x < grid; x++) {
        const a = offset + y * (grid + 1) + x,
          b = a + 1,
          c = a + grid + 1,
          d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
  }
  const p = Buffer.from(new Float32Array(positions).buffer),
    n = Buffer.from(new Float32Array(normals).buffer),
    idx = Buffer.from(new Uint16Array(indices).buffer),
    bin = Buffer.concat([p, n, idx]);
  const doc = {
    asset: {
      version: "2.0",
      generator: "ExhibitOS original synthetic dense cube",
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.05, 0.55, 0.7, 1],
          roughnessFactor: 0.9,
          metallicFactor: 0,
        },
      },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: p.length, target: 34962 },
      { buffer: 0, byteOffset: p.length, byteLength: n.length, target: 34962 },
      {
        buffer: 0,
        byteOffset: p.length + n.length,
        byteLength: idx.length,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: "VEC3",
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: normals.length / 3,
        type: "VEC3",
      },
      {
        bufferView: 2,
        componentType: 5123,
        count: indices.length,
        type: "SCALAR",
      },
    ],
  };
  const json = Buffer.from(JSON.stringify(doc)),
    pad = Buffer.alloc((4 - (json.length % 4)) % 4, 32),
    head = Buffer.alloc(20),
    tail = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(28 + json.length + pad.length + bin.length, 8);
  head.writeUInt32LE(json.length + pad.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  tail.writeUInt32LE(bin.length);
  tail.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, json, pad, tail, bin]);
}
export function loadViewerFixtures() {
  return [
    {
      type: "sculpture",
      mime: "model/gltf-binary",
      bytes: denseCubeGlb(),
      dimensions: { width: 1, height: 1, depth: 1, unit: "m" },
      title: "Original dense synthetic cube",
      triangles: 27648,
    },
    {
      type: "image",
      mime: "image/png",
      bytes: syntheticPng(),
      dimensions: { width: 1, height: 1, depth: 0.02, unit: "m" },
      title: "Original 2048px synthetic color grid",
      textureSize: 2048,
    },
  ];
}
