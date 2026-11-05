// SPDX-License-Identifier: AGPL-3.0-or-later
import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fixtureURL} from '@exhibitos/spec';
import {freezeCanonical} from '@exhibitos/studio-contract';
// @ts-expect-error Test-only ZIP fixture builder has no TypeScript declarations.
import {fixtureZip,exportedEntries} from '../../../scripts/oex-test-zip.mjs';
import {decodeFreezeOex} from './freeze-oex';
const hash=(b:string|Uint8Array)=>createHash('sha256').update(b).digest('hex');
it('rejects draft2 exhibition relabelled as a legacy frozen OEX even with updated hashes',async()=>{
 const entries=exportedEntries(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),map=new Map(entries),manifest=JSON.parse(map.get('manifest.json')),exhibition=JSON.parse(map.get('exhibition.json'));
 exhibition.schemaVersion='1.0.0-draft.2';const bytes=Buffer.from(JSON.stringify(exhibition));manifest.exhibition.bytes=bytes.length;manifest.exhibition.sha256=hash(bytes);manifest.exhibition.revisionSha256=hash(freezeCanonical(exhibition));
 const bad=fixtureZip(entries.map(([name,data]:[string,Buffer])=>[name,name==='manifest.json'?Buffer.from(JSON.stringify(manifest)):name==='exhibition.json'?bytes:data]));
 await expect(decodeFreezeOex(bad,manifest.exhibition.revisionSha256)).rejects.toThrow('OEX_VERSION_UNSUPPORTED');
});
