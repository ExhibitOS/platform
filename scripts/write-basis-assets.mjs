// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const pins=JSON.parse(await readFile(new URL('../vendor/notices/basis-provenance.json',import.meta.url),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const loader=await readFile(new URL('../node_modules/three/examples/jsm/loaders/KTX2Loader.js',import.meta.url));
const js=await readFile(new URL('../node_modules/three/examples/jsm/libs/basis/basis_transcoder.js',import.meta.url));
const wasm=await readFile(new URL('../node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm',import.meta.url));
if(hash(loader)!==pins.loaderSha256||hash(js)!==pins.jsSha256||hash(wasm)!==pins.wasmSha256)throw Error('BASIS_UPSTREAM_INTEGRITY');
const {KTX2Loader}=await import('three/addons/loaders/KTX2Loader.js');
const fn=KTX2Loader.BasisWorker.toString();
const body=['/* Fixed ExhibitOS worker: original pinned Three.js MIT worker and Basis Apache-2.0 implementation. Generated without private sources. */',...['EngineFormat','EngineType','TranscoderFormat','BasisFormat'].map(k=>'let _'+k+' = '+JSON.stringify(KTX2Loader[k])+';'),js.toString(),fn.substring(fn.indexOf('{')+1,fn.lastIndexOf('}'))].join('\n');
const directory=new URL('../apps/web/public/basis/',import.meta.url);await mkdir(directory,{recursive:true});
await writeFile(new URL('basis_transcoder.js',directory),js);await writeFile(new URL('basis_transcoder.wasm',directory),wasm);await writeFile(new URL('exhibitos-basis-worker.js',directory),body);
