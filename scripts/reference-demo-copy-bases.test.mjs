// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifiedCopyBases} from './reference-demo-copy-bases.mjs';

test('does not adopt a v4 copy base using only a parsed active inventory',async t=>{
 const output=await mkdtemp(join(tmpdir(),'exhibitos-copy-base-'));t.after(()=>rm(output,{recursive:true,force:true}));
 await writeFile(join(output,'static-publication-index.json'),JSON.stringify({version:4,assets:[],detailAssets:[]}));
 await assert.rejects(verifiedCopyBases({output,archiveRoot:output,bases:[{}]}),/DEMO_COPY_BASE/);
});
