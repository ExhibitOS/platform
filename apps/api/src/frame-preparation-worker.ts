// SPDX-License-Identifier: AGPL-3.0-or-later
import {prepareExactFrame} from './frame-preparation.ts';
import {MAX_INFO_STAND_SOURCE_BYTES,prepareLegacyInfoStand} from './info-stand-preparation.ts';

// This executable is called only by the bounded intake worker. Never emit the
// input, diagnostics, or filesystem paths. The source is capped before parsing.
const infoStand=process.argv[2]==='info-stand';
try{
 const limit=infoStand?MAX_INFO_STAND_SOURCE_BYTES:32*1024*1024;
 const parts:Buffer[]=[];let size=0;
 for await(const chunk of process.stdin){const part=Buffer.from(chunk as Uint8Array);size+=part.length;if(size>limit)throw Error('limit');parts.push(part);}
 const input=Buffer.concat(parts,size);
 process.stdout.write(infoStand?prepareLegacyInfoStand(input):prepareExactFrame(input).bytes);
}catch{process.stderr.write(infoStand?'INFO_STAND_PREPARATION_UNSAFE\n':'FRAME_PREPARATION_UNSAFE\n');process.exitCode=1;}
