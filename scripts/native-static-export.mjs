// SPDX-License-Identifier: AGPL-3.0-or-later
// Native-only owner channel. The general public-projection exporter stays reusable.
import {fstatSync} from 'node:fs';
import {exportNativeRoomIndirect,exportStaticPublication} from './export-static-publication.mjs';

// Detail diagnostics are fixed literals, never raw child error text. Ordinary
// export keeps its existing output; stdout remains exclusively owner protocol.
const detailCodes=new Set([
  'STATIC_FETCH','STATIC_FILE_TOO_LARGE','STATIC_JSON_SIZE','STATIC_JSON_INVALID',
  'STATIC_PUBLICATION_CHANGED','STATIC_PATH_COLLISION','STATIC_FILE_COUNT',
  'NATIVE_DETAIL_PLAN','NATIVE_DETAIL_STAGE','NATIVE_DETAIL_FRAME','NATIVE_DETAIL_UNAVAILABLE',
  'NATIVE_DETAIL_PIPE','NATIVE_DETAIL_CONTROL','NATIVE_DETAIL_RECEIPT','NATIVE_DETAIL_CANCELLED',
]);
const detailPhases=new Set(['startup','prepare','export','ack','final-check','settle','ready']);
let finished = false,detailPhase;

const parentGone = () => { if (!finished) process.exit(72); };
try {
  const descriptor = fstatSync(0);
  if (!(descriptor.isFIFO() || (descriptor.isSocket() && process.stdin.remoteAddress === undefined && process.stdin.localAddress === undefined))) throw Error('STATIC_OWNER_PIPE_REQUIRED');
  const [origin, publicationId, runtimeRoot, output, ...extra] = process.argv.slice(2);
  if (!origin || !publicationId || !runtimeRoot || !output) throw Error('STATIC_NATIVE_USAGE');
  if(extra.length===1&&extra[0]==='--native-detail-v1'||extra.length===2&&extra[0]==='--private-editor'&&extra[1]==='--native-detail-v1'){
    detailPhase='startup';
    const {runNativeDetailExport}=await import('./native-detail-export-runner.mjs');
    await runNativeDetailExport({origin,publicationId,runtimeRoot,output,privateEditor:extra[0]==='--private-editor',onPhase:phase=>{if(detailPhases.has(phase))detailPhase=phase;}});finished=true;
  }else{
    if(extra.length > 1 || (extra.length === 1 && !['--private-editor','--private-room-indirect-v1'].includes(extra[0]))) throw Error('STATIC_NATIVE_USAGE');
    process.stdin.once('end', parentGone);
    process.stdin.once('error', parentGone);
    // Ordinary mode reads no credentials; owner pipe EOF ends the exporter.
    process.stdin.resume();
    const exporter=extra[0]==='--private-room-indirect-v1'?exportNativeRoomIndirect:exportStaticPublication;
    const receipt = await exporter({origin,publicationId,runtimeRoot,output,privateEditor:extra[0] === '--private-editor'});
    finished = true;
    console.log(JSON.stringify(receipt));
  }
} catch (error) {
  finished = true;
  if(detailPhase){
    const message=typeof error?.message==='string'?error.message:'';
    const code=message.startsWith('STATIC_')?message.split(':',1)[0]:message;
    console.error(`NATIVE_DETAIL_PHASE: ${detailPhase}`);
    console.error(`Error: ${detailCodes.has(code)?code:'STATIC_NATIVE_FAILED'}`);
  }else console.error(/^STATIC_[A-Z_]+(?::|$)/.test(error.message) ? error.message.split(':')[0] : 'STATIC_NATIVE_FAILED');
  process.exitCode = 1;
} finally {
  process.stdin.destroy();
}
