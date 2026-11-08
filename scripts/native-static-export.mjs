// SPDX-License-Identifier: AGPL-3.0-or-later
// Native-only owner channel. The general public-projection exporter stays reusable.
import {fstatSync} from 'node:fs';
import {exportStaticPublication} from './export-static-publication.mjs';

let finished = false;
const parentGone = () => { if (!finished) process.exit(72); };
try {
  const descriptor = fstatSync(0);
  if (!(descriptor.isFIFO() || (descriptor.isSocket() && process.stdin.remoteAddress === undefined && process.stdin.localAddress === undefined))) throw Error('STATIC_OWNER_PIPE_REQUIRED');
  const [origin, publicationId, runtimeRoot, output, ...extra] = process.argv.slice(2);
  if (!origin || !publicationId || !runtimeRoot || !output) throw Error('STATIC_NATIVE_USAGE');
  if(extra.length===1&&extra[0]==='--native-detail-v1'||extra.length===2&&extra[0]==='--private-editor'&&extra[1]==='--native-detail-v1'){
    const {runNativeDetailExport}=await import('./native-detail-export-runner.mjs');
    await runNativeDetailExport({origin,publicationId,runtimeRoot,output,privateEditor:extra[0]==='--private-editor'});finished=true;
  }else{
    if(extra.length > 1 || (extra.length === 1 && extra[0] !== '--private-editor')) throw Error('STATIC_NATIVE_USAGE');
    process.stdin.once('end', parentGone);
    process.stdin.once('error', parentGone);
    // Ordinary mode reads no credentials; owner pipe EOF ends the exporter.
    process.stdin.resume();
    const receipt = await exportStaticPublication({origin,publicationId,runtimeRoot,output,privateEditor:extra[0] === '--private-editor'});
    finished = true;
    console.log(JSON.stringify(receipt));
  }
} catch (error) {
  finished = true;
  console.error(/^STATIC_[A-Z_]+(?::|$)/.test(error.message) ? error.message.split(':')[0] : 'STATIC_NATIVE_FAILED');
  process.exitCode = 1;
} finally {
  process.stdin.destroy();
}
