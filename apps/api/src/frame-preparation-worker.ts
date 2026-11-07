// SPDX-License-Identifier: AGPL-3.0-or-later
import {prepareExactFrame} from './frame-preparation.ts';

// This executable is called only by the bounded intake worker. Never emit the
// input, diagnostics, or filesystem paths. The source is capped before parsing.
try{
 const parts:Buffer[]=[];let size=0;
 for await(const chunk of process.stdin){const part=Buffer.from(chunk as Uint8Array);size+=part.length;if(size>32*1024*1024)throw Error('limit');parts.push(part);}
 const {bytes}=prepareExactFrame(Buffer.concat(parts,size));
 process.stdout.write(bytes);
}catch{process.stderr.write('FRAME_PREPARATION_UNSAFE\n');process.exitCode=1;}
