// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {boundedKtx2} from '@exhibitos/studio-contract';
interface BasisFile {
  isValid():boolean; isUASTC():boolean; getWidth():number; getHeight():number;
  getLayers():number; getLevels():number; getFaces():number; getHasAlpha():boolean;
  startTranscoding():boolean; getImageTranscodedSizeInBytes(level:number,layer:number,face:number,format:number):number;
  transcodeImage(output:Uint8Array,level:number,layer:number,face:number,format:number,flags:number,a:number,b:number):boolean;
  close():void; delete():void;
}
interface BasisModule {initializeBasis():void; KTX2File:new(bytes:Uint8Array)=>BasisFile}
let modulePromise:Promise<BasisModule>|undefined;
function basisModule() {
  return modulePromise??= (async()=>{
    // Execute only the hash-pinned public implementation, never uploaded source.
    const base=new URL('../examples/jsm/libs/basis/',import.meta.resolve('three'));
    const [js,wasm]=await Promise.all([readFile(new URL('basis_transcoder.js',base)),readFile(new URL('basis_transcoder.wasm',base))]);
    const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
    if(hash(js)!=='8478b5b6d6b74e7d3082b89f6417321d8d1dc0307f2b30d4484bb11b441696a1'||hash(wasm)!=='6cf17dc889352c42e9acf8897107978d127005fe3386c36a0e3845e27967630a')throw Error('BASIS_UPSTREAM_INTEGRITY');
    const module:{exports:unknown}={exports:{}};
    const evaluate=new Function('module','exports','require','__dirname',js.toString('utf8'));
    evaluate(module,module.exports,createRequire(import.meta.url),dirname(fileURLToPath(base)));
    const factory=module.exports as (options:{wasmBinary:Buffer;print:()=>void;printErr:()=>void})=>Promise<BasisModule>;
    const result=await factory({wasmBinary:wasm,print:()=>{},printErr:()=>{}});
    result.initializeBasis();return result;
  })();
}
/** Actual bounded RGBA transcoding precedes public approval. Headers alone are not proof. */
export async function verifyBasisPayload(bytes:Uint8Array) {
  const expected=boundedKtx2(bytes),module=await basisModule();
  const file=new module.KTX2File(bytes);
  try {
    if(!file.isValid()||!file.isUASTC()||file.getWidth()!==expected.width||file.getHeight()!==expected.height||file.getLayers()!==0||file.getLevels()!==1||file.getFaces()!==1||file.getHasAlpha()||!file.startTranscoding())throw Error('BASIS_PAYLOAD_INVALID');
    // RGBA32 is the pinned public Basis TranscoderFormat 13. Output is discarded.
    const size=file.getImageTranscodedSizeInBytes(0,0,0,13);
    if(size!==expected.width*expected.height*4||size>8*1024*1024)throw Error('BASIS_PAYLOAD_INVALID');
    const output=new Uint8Array(size);
    if(!file.transcodeImage(output,0,0,0,13,0,-1,-1))throw Error('BASIS_PAYLOAD_INVALID');
    for(let i=3;i<size;i+=4)if(output[i]!==255)throw Error('BASIS_PAYLOAD_INVALID');
  }finally{file.close();file.delete();}
}
