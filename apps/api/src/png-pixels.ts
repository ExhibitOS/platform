// SPDX-License-Identifier: AGPL-3.0-or-later
import {inflateSync} from "node:zlib";
const fail=():never=>{throw Error("invalid format");};
export function pngCrc(data: Buffer) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let i = 0; i < 8; i++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
export function decodePngPixels(data: Buffer, pixelLimit = 4 * 1024 * 1024, dimensionLimit = 8192, chunkLimit = 256) {
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
    closedIdat = false,
    seenSrgb = false,srgbIntent:number|undefined;
  const compressed: Buffer[] = [];
  let chunkCount = 0;
  while (offset < data.length) {
    if (++chunkCount > chunkLimit || offset + 12 > data.length) fail();
    const size = data.readUInt32BE(offset),
      end = offset + 12 + size;
    if (end > data.length) fail();
    const kind = data.toString("latin1", offset + 4, offset + 8);
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(kind)) fail();
    const body = data.subarray(offset + 8, end - 4);
    if (pngCrc(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4))
      fail();
    if (offset === 8) {
      if (kind !== "IHDR" || size !== 13) fail();
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = body[9] === 2 ? 3 : body[9] === 6 ? 4 : 0;
      if (
        !width ||
        !height ||
        width * height > pixelLimit ||
        width > dimensionLimit ||
        height > dimensionLimit ||
        body[8] !== 8 ||
        !channels ||
        body[10] !== 0 ||
        body[11] !== 0 ||
        body[12] !== 0
      )
        fail();
    } else if (kind === "sRGB") {
      // One bounded color-space intent byte; no text, profiles or external data.
      if (seenSrgb || seenIdat || size !== 1 || body[0]! > 3) fail();
      seenSrgb = true;
      srgbIntent=body[0]!;
    } else if (kind === "IDAT") {
      if (closedIdat) fail();
      seenIdat = true;
      compressed.push(body);
    } else if (kind === "IEND") {
      if (size !== 0 || !seenIdat || end !== data.length) fail();
      ended = true;
    } else {
      if (seenIdat) closedIdat = true;
      /* Reject other ancillary metadata and unknown critical chunks. */ fail();
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
  return { pixels: result.buffer, width, height, channels,srgbIntent };
}
