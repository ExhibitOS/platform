import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixtureURL} from '@exhibitos/spec';
import {decode} from '../apps/api/dist/imports.js';
const image=await readFile(fixtureURL('fixtures/synthetic/painting.png'));
const crc=bytes=>{let v=0xffffffff;for(const b of bytes){v^=b;for(let i=0;i<8;i++)v=(v>>>1)^((v&1)?0xedb88320:0);}return(v^0xffffffff)>>>0;};
const records=[];for(let at=8;at<image.length;){const size=image.readUInt32BE(at),end=at+size+12;records.push({kind:image.toString('ascii',at+4,at+8),bytes:image.subarray(at,end)});at=end;}
function chunk(kind,body){const bytes=Buffer.alloc(body.length+12);bytes.writeUInt32BE(body.length);bytes.write(kind,4);body.copy(bytes,8);bytes.writeUInt32BE(crc(bytes.subarray(4,bytes.length-4)),bytes.length-4);return bytes;}
const assemble=rows=>Buffer.concat([image.subarray(0,8),...rows]);
test('isolated PNG decoder accepts original public sRGB artwork and every bounded intent',async()=>{
  assert.equal(records.filter(r=>r.kind==='sRGB').length,1);
  await decode(image,'image/png');
  for(let intent=0;intent<4;intent++)await decode(assemble(records.map(r=>r.kind==='sRGB'?chunk('sRGB',Buffer.from([intent])):r.bytes)),'image/png');
});
test('isolated PNG decoder rejects malformed, repeated or late sRGB and text payload',async()=>{
  const base=records.filter(r=>r.kind!=='sRGB').map(r=>r.bytes);
  for(const replacement of [chunk('sRGB',Buffer.from([4])),chunk('sRGB',Buffer.from([0,0])),chunk('sRGB',Buffer.alloc(0)),chunk('tEXt',Buffer.from('private\0not allowed'))]){
    await assert.rejects(()=>decode(assemble([base[0],replacement,...base.slice(1)]),'image/png'));
  }
  const valid=chunk('sRGB',Buffer.from([0]));
  await assert.rejects(()=>decode(assemble([base[0],valid,valid,...base.slice(1)]),'image/png'));
  await assert.rejects(()=>decode(assemble([...base.slice(0,-1),valid,base.at(-1)]),'image/png'));
});
