// SPDX-License-Identifier: AGPL-3.0-or-later
import {decodePngPixels as png,pngCrc as crc} from './png-pixels.ts';
import {deflateSync} from 'node:zlib';
import {embeddedLabelMask} from './watermark-label.ts';
import type {DisplayWatermark} from '@exhibitos/studio-contract';
function pngChunk(name: string, body: Buffer) {
  const header = Buffer.alloc(8),
    tail = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  header.write(name, 4);
  tail.writeUInt32BE(crc(Buffer.concat([header.subarray(4), body])));
  return Buffer.concat([header, body, tail]);
}
export function renderPngDerivative(data:Buffer, limit:number, roleLimit:boolean, watermark:DisplayWatermark, pixelLimit:number, dimensionLimit:number, chunkLimit:number) {
  const decoded = png(data,pixelLimit,dimensionLimit,chunkLimit),
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