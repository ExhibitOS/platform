// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,expect,it} from 'vitest';
import {availableCatalogBench,BENCH_CATALOG,BENCH_CATALOG_PATH,BENCH_NOTICE_PATH} from './catalog-bench';
import {REFINED_BENCH} from '@exhibitos/studio-contract';
import type {PrivateSeed} from './model';
const seed={source:{publication:{id:'publication',revisionSha256:'revision'}},indexSha256:'index'} as PrivateSeed;
const manifest=()=>({format:'exhibitos-static-publication-v1',publicationId:'publication',revisionSha256:'revision',indexSha256:'index',files:[{path:BENCH_CATALOG_PATH,bytes:BENCH_CATALOG.bytes,sha256:BENCH_CATALOG.sha256},{path:BENCH_NOTICE_PATH,bytes:BENCH_CATALOG.rights.noticeBytes,sha256:BENCH_CATALOG.rights.noticeSha256}]});
describe('private bench catalogue',()=>{
 it('advertises only the exact model and notice bound to the loaded source',()=>{const m=manifest();expect(availableCatalogBench(m,seed)).toBe(true);m.files[1]!.sha256='0'.repeat(64);expect(availableCatalogBench(m,seed)).toBe(false);m.indexSha256='other';expect(availableCatalogBench(m,seed)).toBe(false);});
 it('rejects duplicate file paths and missing notice',()=>{const m=manifest();m.files.push(m.files[0]!);expect(availableCatalogBench(m,seed)).toBe(false);m.files=[m.files[0]!];expect(availableCatalogBench(m,seed)).toBe(false);});
});

it('admits the refined catalogue only with its own exact model and notice pair',()=>{
 const path='furnish-catalog/sculpture-bench-refined/1/',entry=REFINED_BENCH,m={...manifest(),files:[{path:path+'model.glb',bytes:entry.bytes,sha256:entry.sha256},{path:path+'LICENSE-NOTICE.txt',bytes:entry.rights.noticeBytes,sha256:entry.rights.noticeSha256}]};
 expect(availableCatalogBench(m,seed,'sculpture-bench-refined')).toBe(true);expect(availableCatalogBench(manifest(),seed,'sculpture-bench-refined')).toBe(false);
 m.files[0]!.sha256=BENCH_CATALOG.sha256;expect(availableCatalogBench(m,seed,'sculpture-bench-refined')).toBe(false);
});
