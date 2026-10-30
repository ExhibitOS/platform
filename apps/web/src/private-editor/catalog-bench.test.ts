// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,expect,it} from 'vitest';
import {availableCatalogBench,BENCH_CATALOG,BENCH_CATALOG_PATH,BENCH_NOTICE_PATH} from './catalog-bench';
import type {PrivateSeed} from './model';
const seed={source:{publication:{id:'publication',revisionSha256:'revision'}},indexSha256:'index'} as PrivateSeed;
const manifest=()=>({format:'exhibitos-static-publication-v1',publicationId:'publication',revisionSha256:'revision',indexSha256:'index',files:[{path:BENCH_CATALOG_PATH,bytes:BENCH_CATALOG.bytes,sha256:BENCH_CATALOG.sha256},{path:BENCH_NOTICE_PATH,bytes:BENCH_CATALOG.rights.noticeBytes,sha256:BENCH_CATALOG.rights.noticeSha256}]});
describe('private bench catalogue',()=>{
 it('advertises only the exact model and notice bound to the loaded source',()=>{const m=manifest();expect(availableCatalogBench(m,seed)).toBe(true);m.files[1]!.sha256='0'.repeat(64);expect(availableCatalogBench(m,seed)).toBe(false);m.indexSha256='other';expect(availableCatalogBench(m,seed)).toBe(false);});
 it('rejects duplicate file paths and missing notice',()=>{const m=manifest();m.files.push(m.files[0]!);expect(availableCatalogBench(m,seed)).toBe(false);m.files=[m.files[0]!];expect(availableCatalogBench(m,seed)).toBe(false);});
});
