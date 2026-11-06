// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {prepareWorkspaceOexTerminalProof} from './workspace-oex-terminal-proof.ts';
const fixture=JSON.parse(await readFile(new URL('../test-fixtures/workspace-oex-terminal-v1.json',import.meta.url),'utf8')) as {scope:Parameters<typeof prepareWorkspaceOexTerminalProof>[0];result:Record<string,unknown>;proof:Record<string,unknown>;resultUtf8:string;proofUtf8:string};
it('produces the pinned canonical result bytes and fixed ordered proof for replay',()=>{
 const output=prepareWorkspaceOexTerminalProof(fixture.scope,fixture.result);expect(output.resultBytes.toString('utf8')).toBe(fixture.resultUtf8);expect(output.proofBytes.toString('utf8')).toBe(fixture.proofUtf8);expect(output.proof).toEqual(fixture.proof);expect(createHash('sha256').update(output.resultBytes).digest('hex')).toBe(output.proof.resultSha256);expect(output.resultBytes.length).toBe(output.proof.resultBytes);
 const s=fixture.scope,reordered={sourceArchiveSha256:s.sourceArchiveSha256,importRequestId:s.importRequestId,attemptId:s.attemptId,jobId:s.jobId,principalId:s.principalId,tenantId:s.tenantId,workspaceId:s.workspaceId};expect(prepareWorkspaceOexTerminalProof(reordered,fixture.result).proofBytes).toEqual(output.proofBytes);
});
it('rejects wrong ownership scope, inconsistent saved outcome and oversized or non-finite result',()=>{
 expect(()=>prepareWorkspaceOexTerminalProof({...fixture.scope,sourceArchiveSha256:'A'.repeat(64)},fixture.result)).toThrow('OEX_TERMINAL_PROOF');expect(()=>prepareWorkspaceOexTerminalProof({...fixture.scope,workspaceId:'ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF'},fixture.result)).toThrow('OEX_TERMINAL_PROOF');expect(()=>prepareWorkspaceOexTerminalProof({...fixture.scope,extra:'no'} as never,fixture.result)).toThrow('OEX_TERMINAL_PROOF');
 expect(()=>prepareWorkspaceOexTerminalProof(fixture.scope,{...fixture.result,etag:'"studio-r1-'+ '0'.repeat(64)+'"'})).toThrow('OEX_TERMINAL_PROOF');expect(()=>prepareWorkspaceOexTerminalProof(fixture.scope,{...fixture.result,exhibitionId:fixture.scope.jobId})).toThrow('OEX_TERMINAL_PROOF');expect(()=>prepareWorkspaceOexTerminalProof(fixture.scope,{...fixture.result,revision:2})).toThrow('OEX_TERMINAL_PROOF');expect(()=>prepareWorkspaceOexTerminalProof(fixture.scope,{...fixture.result,extra:Infinity})).toThrow('OEX_TERMINAL_PROOF');expect(()=>prepareWorkspaceOexTerminalProof(fixture.scope,{...fixture.result,extra:'x'.repeat(4*1024*1024)})).toThrow('OEX_TERMINAL_PROOF');
});
