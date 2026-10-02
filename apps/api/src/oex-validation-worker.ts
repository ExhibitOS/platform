// SPDX-License-Identifier: AGPL-3.0-or-later
// Archive parsing/CRC/inflation/GLB inspection is isolated from the HTTP process.
import {readOex} from '@exhibitos/spec';
const limit=67108864,chunks:Buffer[]=[];let size=0;
try {
 for await(const chunk of process.stdin){size+=chunk.length;if(size>limit)throw Error('limit');chunks.push(chunk);}
 const result=await readOex(Buffer.concat(chunks));
 const files=[...result.files.entries()].map(([path,bytes])=>[path,Buffer.from(bytes).toString('base64')]);
 process.stdout.write(JSON.stringify({manifest:result.manifest,exhibition:result.exhibition,files}));
}catch{process.exitCode=1;}
