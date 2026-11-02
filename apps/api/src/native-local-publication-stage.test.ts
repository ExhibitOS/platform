// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,readdir,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
import type {NativeLocalExportContext} from './native-oex-provenance.ts';
import {PublicationByteStage} from './publication-byte-stage.ts';
import {NativeLocalPublicationStage} from './native-local-publication-stage.ts';
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'native-publication-test-')));roots.push(root);const path=join(root,'blobs');await mkdir(path,{mode:0o700});const blobs=new FileBlobStore(path),c={} as PoolClient;
 const s={id:randomUUID(),tenantId:randomUUID(),userId:randomUUID(),role:'admin',expiresAt:'2099-01-01T00:00:00Z'} as Session;
 const context={workspaceId:randomUUID(),tenantId:s.tenantId,principalId:s.userId,assertDatabase:vi.fn(async()=>{})} as unknown as NativeLocalExportContext;
 const id=randomUUID(),requestId=randomUUID(),etag='"studio-r1-'+ 'a'.repeat(64)+'"';return {root,blobs,c,s,context,id,requestId,etag};
}
it('retires only its own marker after a committed, drained operation',async()=>{
 const f=await fixture(),op=await NativeLocalPublicationStage.create(f.c,f.s,f.context,f.blobs,'publish',f.id,f.etag,f.requestId),stage=await op.claim(f.c,f.s,f.blobs,'publish',f.id,f.etag,f.requestId);op.markEffectsPossible();const ref=await stage.append(Buffer.from('source'));expect(await stage.read(ref)).toEqual(Buffer.from('source'));
 await op.manifest(randomUUID(),'a'.repeat(64),[]);await op.close();await op.finish(true);expect(await readdir(f.root)).toEqual(['blobs']);
});
it('retains the marker after a potentially effectful failed operation and refuses another',async()=>{
 const f=await fixture(),op=await NativeLocalPublicationStage.create(f.c,f.s,f.context,f.blobs,'readiness',f.id,f.etag),stage=await op.claim(f.c,f.s,f.blobs,'readiness',f.id,f.etag);op.markEffectsPossible();await stage.append(Buffer.from('source'));await op.finish(false);
 expect(await readdir(f.root)).toContain(`native-publication-${f.context.workspaceId}`);await expect(NativeLocalPublicationStage.create(f.c,f.s,f.context,f.blobs,'readiness',f.id,f.etag)).rejects.toMatchObject({code:'PUBLICATION_STAGE_BUSY'});
});
it('does not remove marker after stage close failure',async()=>{
 const f=await fixture(),op=await NativeLocalPublicationStage.create(f.c,f.s,f.context,f.blobs,'readiness',f.id,f.etag);vi.spyOn(PublicationByteStage.prototype,'close').mockRejectedValue(Error('close failed'));await expect(op.close()).rejects.toThrow('close failed');await expect(op.finish(false)).rejects.toThrow('close failed');expect(await readdir(f.root)).toContain(`native-publication-${f.context.workspaceId}`);
});
it('rejects another session or request binding',async()=>{
 const f=await fixture(),op=await NativeLocalPublicationStage.create(f.c,f.s,f.context,f.blobs,'publish',f.id,f.etag,f.requestId);await expect(op.claim(f.c,{...f.s,id:randomUUID()},f.blobs,'publish',f.id,f.etag,f.requestId)).rejects.toThrow('PUBLICATION_STAGE_BINDING');await op.finish(false);
});
