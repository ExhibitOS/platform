// SPDX-License-Identifier: AGPL-3.0-or-later
import {furnishingCatalogueEntry} from '@exhibitos/studio-contract';
import type {PrivateSeed} from './model';

export type BenchCatalogId='backless-oak-bench'|'sculpture-bench-refined';
export const BENCH_CATALOG_PATH='furnish-catalog/backless-oak-bench/1/model.glb';
export const BENCH_NOTICE_PATH='furnish-catalog/backless-oak-bench/1/LICENSE-NOTICE.txt';
export const BENCH_CATALOG=furnishingCatalogueEntry('backless-oak-bench');
export const BENCH_RESERVE_BYTES=2*1024*1024;
export function catalogBenchReserve(catalogId:string){return catalogId==='sculpture-bench-refined'?8*1024*1024:BENCH_RESERVE_BYTES;}
export function availableCatalogBench(value:unknown,seed:Pick<PrivateSeed,'source'|'indexSha256'>,catalogId:BenchCatalogId='backless-oak-bench'){
 const entry=furnishingCatalogueEntry(catalogId),path=`furnish-catalog/${catalogId}/1/`;
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const m=value as Record<string,unknown>;
 if(m.format!=='exhibitos-static-publication-v1'||m.publicationId!==seed.source.publication.id||m.revisionSha256!==seed.source.publication.revisionSha256||m.indexSha256!==seed.indexSha256||!Array.isArray(m.files)||m.files.length>20000)return false;
 const files=new Map<string,{bytes?:unknown;sha256?:unknown}>();for(const entry of m.files){if(!entry||typeof entry!=='object'||Array.isArray(entry)||typeof entry.path!=='string'||files.has(entry.path))return false;files.set(entry.path,entry);}
 const model=files.get(path+'model.glb'),notice=files.get(path+'LICENSE-NOTICE.txt');return model?.bytes===entry.bytes&&model.sha256===entry.sha256&&notice?.bytes===entry.rights.noticeBytes&&notice.sha256===entry.rights.noticeSha256;
}
export async function loadCatalogBench(seed:PrivateSeed,signal:AbortSignal,catalogId:BenchCatalogId='backless-oak-bench'){
 try{await seed.source.local!.check();const r=await fetch('/static-export-manifest.json',{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});if(!r.ok||!r.body)return false;const reader=r.body.getReader(),chunks:Uint8Array[]=[];let n=0;try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>4*1024*1024){await reader.cancel();return false;}chunks.push(value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(n);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.length;}return availableCatalogBench(JSON.parse(new TextDecoder().decode(bytes)),seed.catalogueBase??seed,catalogId);}catch{return false;}
}
