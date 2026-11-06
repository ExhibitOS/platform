// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {sha256} from '@exhibitos/storage';
import {expect,it} from 'vitest';
import {validateWorkspaceFurnishingGlb} from './workspace-furnishing-glb.ts';
const path=new URL('../../../assets/furnishings/user-authored-20261027/rectangular-plinth/model.glb',import.meta.url);
const fixture=async()=>{const bytes=await readFile(path);return {bytes,model:{mime:'model/gltf-binary' as const,bytes:bytes.length,sha256:sha256(bytes)}};};
it('accepts the exact preserved representative GLB without transforming bytes',async()=>{const {bytes,model}=await fixture();expect(model.sha256).toBe('67db8564375294bf9dcd867d94fa5754c6cbcefb67c5e2a5563aed876f79c02b');await expect(validateWorkspaceFurnishingGlb(model,bytes)).resolves.toBeUndefined();expect(sha256(bytes)).toBe(model.sha256);},15000);
it('rejects a corrupt GLB and mismatched declaration',async()=>{const {bytes,model}=await fixture();await expect(validateWorkspaceFurnishingGlb({...model,sha256:'0'.repeat(64)},bytes)).rejects.toMatchObject({code:'UPLOAD_INTEGRITY'});const changed=Buffer.from(bytes);changed[0]=0;await expect(validateWorkspaceFurnishingGlb({...model,sha256:sha256(changed)},changed)).rejects.toMatchObject({code:'FORMAT_REJECTED'});},15000);
it('does not classify an interrupted worker as invalid input before close',async()=>{const {bytes,model}=await fixture();let closed=false;await expect(validateWorkspaceFurnishingGlb(model,bytes,{onSpawn:child=>{child.once('close',()=>{closed=true;});child.kill('SIGKILL');}})).rejects.toMatchObject({code:'FURNISHING_VALIDATION_UNAVAILABLE'});expect(closed).toBe(true);},15000);
