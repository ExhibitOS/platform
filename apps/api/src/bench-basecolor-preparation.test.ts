// SPDX-License-Identifier: AGPL-3.0-or-later
import {createRequire} from 'node:module';
import {deflateSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {prepareBenchBaseColor} from './bench-basecolor-preparation.ts';

const {publicTexturedGLB,changeTextureGLB,texturePNGChunk} = createRequire(import.meta.url)('../../../scripts/embedded-texture-fixture.mjs') as {
  publicTexturedGLB(options: {png: Buffer; images: number}): Buffer;
  changeTextureGLB(bytes: Buffer, edit: (document: {samplers: object[]}) => void): Buffer;
  texturePNGChunk(type: string, body: Buffer): Buffer;
};

function legacySource(firstExifTag: number) {
  const width = 768, height = 5;
  const imageHeader = Buffer.alloc(13);
  imageHeader.writeUInt32BE(width);
  imageHeader.writeUInt32BE(height, 4);
  imageHeader[8] = 8;
  imageHeader[9] = 2;
  const exif = Buffer.from('4d4d002a00000018000000480000000100000048000000010002011a00050000000100000008011b0005000000010000001000000000', 'hex');
  exif.writeUInt16BE(firstExifTag, 26);
  const png = Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    texturePNGChunk('IHDR', imageHeader),
    texturePNGChunk('sRGB', Buffer.from([0])),
    texturePNGChunk('eXIf', exif),
    texturePNGChunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height), {level: 0})),
    texturePNGChunk('IEND', Buffer.alloc(0)),
  ]);
  return changeTextureGLB(publicTexturedGLB({png, images: 2}), document => {
    document.samplers = [{magFilter: 9729, minFilter: 9987}];
  });
}

it('strips resolution-only EXIF but rejects a CRC-valid orientation tag', async () => {
  const source = legacySource(0x011a);
  expect((await prepareBenchBaseColor(source, true)).length).toBeLessThan(source.length);
  await expect(prepareBenchBaseColor(legacySource(0x0112), true)).rejects.toThrow('BENCH_BASECOLOR_PREPARATION_UNSAFE');
});
