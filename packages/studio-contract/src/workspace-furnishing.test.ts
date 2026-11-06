// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {validWorkspaceFurnishingDeclaration} from './workspace-furnishing.ts';
const base={requestId:'10000000-0000-4000-8000-000000000001',kind:'pedestal',name:'Synthetic plinth',rights:{},provenance:'Synthetic',model:{mime:'model/gltf-binary',bytes:100,sha256:'a'.repeat(64)}};
it('accepts only bounded explicit workspace furnishing declarations',()=>{
 expect(validWorkspaceFurnishingDeclaration(base)).toBe(true);
 for(const bad of [{...base,kind:'sculpture'},{...base,requestId:'not-a-uuid'},{...base,name:'  '},{...base,provenance:''},{...base,model:{...base.model,bytes:32*1024*1024+1}},{...base,model:{...base.model,sha256:'A'.repeat(64)}},{...base,model:{...base.model,path:'/tmp/input'}},{...base,extra:true}])expect(validWorkspaceFurnishingDeclaration(bad)).toBe(false);
});

it('keeps workspace furnishing references and per-exhibition poses separate from the builtin catalogue',async()=>{
 const {validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE}=await import('./workspace-furnishing.ts');const furnishing={id:'10000000-0000-4000-8000-000000000002',version:1,kind:base.kind,name:base.name,rights:base.rights,provenance:base.provenance,model:base.model},roomId='10000000-0000-4000-8000-000000000003',placement={id:'10000000-0000-4000-8000-000000000004',roomId,furnishingId:furnishing.id,furnishingVersion:1,position:[1,0,0],yaw:0,scale:1},candidate={rooms:[{id:roomId,dimensions:{width:10,depth:10,height:4}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:1,furnishings:[furnishing],placements:[placement]}}};
 expect(validateWorkspaceFurnishings(candidate).valid).toBe(true);const missing=structuredClone(candidate);missing.extensions[WORKSPACE_FURNISHING_NAMESPACE]!.placements[0]!.furnishingId='10000000-0000-4000-8000-000000000099';expect(validateWorkspaceFurnishings(missing).valid).toBe(false);const outside=structuredClone(candidate);outside.extensions[WORKSPACE_FURNISHING_NAMESPACE]!.placements[0]!.position=[6,0,0];expect(validateWorkspaceFurnishings(outside).valid).toBe(false);
});
