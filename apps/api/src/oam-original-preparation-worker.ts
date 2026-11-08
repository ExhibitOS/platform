// SPDX-License-Identifier: AGPL-3.0-or-later
import {Socket} from 'node:net';
import {COMPACT_MODEL_RECIPE,compactModelRecipeFor,prepareCompactModel,type CompactModelProfile,type ModelPreparationInput} from './oam-original-preparation.ts';
// EOF on this private parent pipe terminates a stranded producer. An optional
// native writer FD is inherited separately and remains held until child close.
const parent=new Socket({fd:3,readable:true,writable:false});parent.once('end',()=>process.exit(70));parent.once('error',()=>process.exit(70));parent.resume();
try{
 const identity=JSON.parse(process.argv[2]??'null') as ModelPreparationInput;
 const profile=(process.argv[3]??COMPACT_MODEL_RECIPE.id) as CompactModelProfile;
 const {limits}=compactModelRecipeFor(profile);
 const chunks:Buffer[]=[];let size=0;
 for await(const part of process.stdin){const bytes=Buffer.from(part);size+=bytes.length;if(size>limits.sourceBytes)throw Error('MODEL_PREPARATION_INPUT_INTEGRITY');chunks.push(bytes);}
 const result=await prepareCompactModel(Buffer.concat(chunks,size),identity,profile),usage=process.resourceUsage();
 const metadata=Buffer.from(JSON.stringify({receipt:result.receipt,resourceUsage:{peakRssKiB:usage.maxRSS,cpuMicros:usage.userCPUTime+usage.systemCPUTime}})),header=Buffer.alloc(8);header.write('EMCP');header.writeUInt32LE(metadata.length,4);
 process.stdout.write(Buffer.concat([header,metadata,result.bytes]));
}catch(error){process.stderr.write(error instanceof Error&&/^MODEL_PREPARATION_[A-Z_]+$/.test(error.message)?error.message+'\n':'MODEL_PREPARATION_FAILED\n');process.exitCode=1;}finally{parent.destroy();}
