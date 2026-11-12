// SPDX-License-Identifier: AGPL-3.0-or-later
import {mkdir,lstat,realpath,readdir} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {assertIssuedFurnishingWriterLease} from './native-workspace-furnishing-admission.mjs';
import {assertModelPreparationExecution} from '../apps/api/dist/model-preparation-import.js';
import {assertGpuModelEncoderReady} from '../apps/api/dist/gpu-model-encoder.js';
import {GpuModelPreparations} from '../apps/api/dist/gpu-model-preparations.js';
const fail=()=>{throw Error('NATIVE_GPU_MODEL_PREPARATION_UNAVAILABLE');};
async function directory(path,privateOnly=true){const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==path||stat.uid!==process.getuid?.()||(privateOnly?(stat.mode&0o777)!==0o700:(stat.mode&0o022)!==0))fail();return stat;}
/** Called only after exact049 ordinary catalog admission, with the existing
 * issued writer/execution. Scratch is never placed in durable blob/config data. */
export async function prepareNativeGpuModelRuntime({pool,execution,writer,blobRoot,configRoot,payloadRoot}){
 assertIssuedFurnishingWriterLease(writer);assertModelPreparationExecution(execution,execution.blobs,execution.workspace);
 if(execution.mode!=='native'||execution.writer!==writer||!execution.workspace||basename(blobRoot)!=='blobs'||basename(configRoot)!=='config'||dirname(blobRoot)!==dirname(configRoot)||[blobRoot,configRoot,payloadRoot].some(p=>typeof p!=='string'||resolve(p)!==p))fail();
 await writer.assertLive();await directory(blobRoot,false);await directory(configRoot,false);const root=dirname(blobRoot),before=await directory(root),jobRoot=join(root,'native-gpu-model-jobs');
 if(payloadRoot===root||payloadRoot.startsWith(root+'/')||root.startsWith(payloadRoot+'/'))fail();
 try{await mkdir(jobRoot,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 await directory(jobRoot);const after=await directory(root);if(before.dev!==after.dev||before.ino!==after.ino)fail();
 const managedPrefix=join(payloadRoot,'platform/tools/ktx-4.4.2-noetc');await assertGpuModelEncoderReady(managedPrefix);await writer.assertLive();
 return {jobs:new GpuModelPreparations(pool,execution,managedPrefix,jobRoot),jobRoot};
}
/** Promise settlement is insufficient when an encoder left unknown drain tokens
 * or scratch. Preserve both and withhold the ordinary stop acknowledgement. */
export async function assertNativeGpuModelDrained(pool,jobRoot){
 const result=await pool.query("SELECT EXISTS(SELECT 1 FROM import_jobs WHERE gpu_preparation IS NOT NULL AND (lease_id IS NOT NULL OR lease_until IS NOT NULL OR cardinality(png_worker_tokens)>0)) AS pending");
 if(result.rows[0]?.pending!==false)throw Error('NATIVE_GPU_MODEL_WORK_PENDING');
 await directory(jobRoot);if((await readdir(jobRoot)).length)throw Error('NATIVE_GPU_MODEL_WORK_PENDING');
}
