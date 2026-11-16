// SPDX-License-Identifier: AGPL-3.0-or-later
import {prepareExactFrame} from './frame-preparation.ts';
import {MAX_INFO_STAND_SOURCE_BYTES,prepareLegacyInfoStand} from './info-stand-preparation.ts';
import {MAX_BENCH_PREPARATION_SOURCE_BYTES,prepareBenchBaseColor} from './bench-basecolor-preparation.ts';

// This executable is called only by the bounded intake worker. Never emit the
// input, diagnostics, or filesystem paths. The source is capped before parsing.
const infoStand=process.argv[2]==='info-stand';
const bench=process.argv[2]==='bench-basecolor';
try{
 const limit=bench?MAX_BENCH_PREPARATION_SOURCE_BYTES:infoStand?MAX_INFO_STAND_SOURCE_BYTES:32*1024*1024;
 const parts:Buffer[]=[];let size=0;
 for await(const chunk of process.stdin){const part=Buffer.from(chunk as Uint8Array);size+=part.length;if(size>limit)throw Error('limit');parts.push(part);}
 const input=Buffer.concat(parts,size);
 process.stdout.write(bench?await prepareBenchBaseColor(input):infoStand?prepareLegacyInfoStand(input):prepareExactFrame(input).bytes);
}catch{process.stderr.write(bench?'BENCH_BASECOLOR_PREPARATION_UNSAFE\n':infoStand?'INFO_STAND_PREPARATION_UNSAFE\n':'FRAME_PREPARATION_UNSAFE\n');process.exitCode=1;}
