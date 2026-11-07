// SPDX-License-Identifier: AGPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {readApprovedCopyBases,verifiedCopyBases} from '../../scripts/reference-demo-copy-bases.mjs';
const root=fileURLToPath(new URL('.',import.meta.url)),source=join(root,'source'),hash=b=>createHash('sha256').update(b).digest('hex');
test('the pinned public r3 projection has exact content and retains previous copy bases',async()=>{
 const pin=JSON.parse(await readFile(join(root,'publication.json'))),indexBytes=await readFile(join(source,'static-publication-index.json'));assert.equal(hash(indexBytes),pin.indexSha256);const index=JSON.parse(indexBytes);
 for(const entry of [index.publication,...index.assets,...index.resources??[],...index.furnishingNotices??[]]){const bytes=await readFile(join(source,entry.path));assert.equal(bytes.length,entry.bytes);assert.equal(hash(bytes),entry.sha256);}
 const data=JSON.parse(await readFile(join(source,index.publication.path)));assert.equal(data.publication.id,pin.publicationId);assert.equal(data.publication.revisionSha256,pin.revisionSha256);assert.equal(data.exhibition.artworks.length,15);
 assert.doesNotMatch(JSON.stringify(data),/org\.exhibitos\.studio\/cms|\/Volumes\/|object_key|principalId|tenantId/);
 const bases=await readApprovedCopyBases(join(root,'previous-copy-bases.json'));assert(bases.some(v=>v.indexSha256==='b75e849f53b2b7a37c6b77c9e4d0318beaaed0fb991cdab4b944d43b11932e08'));assert.equal((await verifiedCopyBases({output:source,archiveRoot:root,bases})).length,bases.length*2);
});
