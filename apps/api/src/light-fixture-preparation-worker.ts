// SPDX-License-Identifier: AGPL-3.0-or-later
import {prepareLightFixtureSource} from './light-fixture-preparation.ts';

// Invoked only by the bounded product preparation process. The binary result
// carries a bounded receipt followed by the derived GLB, never source paths.
try{
 const parts:Buffer[]=[];let size=0;
 for await(const chunk of process.stdin){const bytes=Buffer.from(chunk as Uint8Array);size+=bytes.length;if(size>8*1024*1024)throw Error('limit');parts.push(bytes);}
 const result=prepareLightFixtureSource(Buffer.concat(parts,size)),receipt=Buffer.from(JSON.stringify(result.receipt));
 if(receipt.length>65536)throw Error('receipt');
 const header=Buffer.alloc(4);header.writeUInt32LE(receipt.length);
 process.stdout.write(Buffer.concat([header,receipt,result.bytes]));
}catch{
 process.stderr.write('LIGHT_FIXTURE_PREPARATION_UNSAFE\n');process.exitCode=1;
}
