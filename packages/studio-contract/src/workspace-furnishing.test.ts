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

it('requires explicit v2 for stool while retaining v1 rejection',async()=>{
 const {validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE}=await import('./workspace-furnishing.ts');
 const stool={...base,kind:'stool'};
 expect(validWorkspaceFurnishingDeclaration(stool)).toBe(false);
 expect(validWorkspaceFurnishingDeclaration(stool,{allowStool:true})).toBe(true);
 const {requestId:_,...descriptor}=stool;void _;
 const roomId='10000000-0000-4000-8000-000000000003',id='10000000-0000-4000-8000-000000000002';
 const extension={version:2,furnishings:[{...descriptor,id,version:1}],placements:[{id:'10000000-0000-4000-8000-000000000004',roomId,furnishingId:id,furnishingVersion:1,position:[1,0,0],yaw:0,scale:1}]};
 const candidate={rooms:[{id:roomId,dimensions:{width:10,depth:10,height:4}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:extension}};
 expect(validateWorkspaceFurnishings(candidate).valid).toBe(true);
 for(const version of [1,4,'2']){extension.version=version as number;expect(validateWorkspaceFurnishings(candidate).valid).toBe(false);}
});

it('accepts exact room-visual kinds only under v3 while retaining prior kinds',async()=>{
 const {validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE}=await import('./workspace-furnishing.ts'),roomId='10000000-0000-4000-8000-000000000003',id='10000000-0000-4000-8000-000000000002';
 for(const kind of ['partition','info-stand','barrier','display-case']){
  const declaration={...base,kind};expect(validWorkspaceFurnishingDeclaration(declaration)).toBe(false);expect(validWorkspaceFurnishingDeclaration(declaration,{allowStool:true})).toBe(false);expect(validWorkspaceFurnishingDeclaration(declaration,{allowRoomVisual:true})).toBe(true);
  const {requestId:_,...fields}=declaration;void _;const extension={version:3,furnishings:[{...fields,id,version:1}],placements:[{id:'10000000-0000-4000-8000-000000000004',roomId,furnishingId:id,furnishingVersion:1,position:[1,0,0],yaw:0,scale:1}]},candidate={rooms:[{id:roomId,dimensions:{width:10,depth:10,height:4}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:extension}};
  expect(validateWorkspaceFurnishings(candidate).valid).toBe(true);extension.version=2;expect(validateWorkspaceFurnishings(candidate).valid).toBe(false);
 }
});

it('binds the fixed frame to one exact compatible image placement',async()=>{
 const {validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE}=await import('./workspace-furnishing.ts');
 const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,sha='4b14e45ccf14ed38eea90c50553733a0b97b1671b9ec377d900e5a947545f8b4';
 const item={id:id(2),version:1,kind:'artwork-frame',name:'Brass',rights:{},provenance:'Synthetic',model:{mime:'model/gltf-binary',bytes:7892,sha256:sha}},art={id:id(8),revisionId:id(5),primaryAssetId:id(6),schemaVersion:'1.0.0-draft.1',artworkType:'image',dimensions:{width:.6,height:.8},transform:{scale:[1,1,1]}},placement={id:id(4),roomId:id(1),artworkRevisionId:id(5),assetId:id(6),transform:{scale:[1,1,1]}};
 const candidate={rooms:[{id:id(1),dimensions:{width:6,height:3,depth:8},transform:{scale:[1,1,1]}}],artworks:[art],placements:[placement],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:4,furnishings:[item],placements:[],frameAttachments:[{placementId:id(4),artworkRevisionId:id(5),assetId:id(6),furnishingId:id(2),furnishingVersion:1,modelSha256:sha}]}}};
 expect(validateWorkspaceFurnishings(candidate).valid).toBe(true);
 art.dimensions.height=.6;expect(validateWorkspaceFurnishings(candidate).errors[0]?.code).toBe('FRAME_SIZE_UNSUPPORTED');art.dimensions.height=.8;
 placement.assetId=id(9);expect(validateWorkspaceFurnishings(candidate).errors[0]?.code).toBe('FRAME_TARGET_STALE');placement.assetId=id(6);
 const floatSha='d4bdc4201fe2e8866652350915799a346ba07cf73078fec9f7f6e275287e918a';candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE].version=5;item.model.sha256=floatSha;item.model.bytes=152056;candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE].frameAttachments[0]!.modelSha256=floatSha;
 expect(validateWorkspaceFurnishings(candidate).valid).toBe(true);item.model.bytes++;expect(validateWorkspaceFurnishings(candidate).errors[0]?.code).toBe('FRAME_ASSET_UNSUPPORTED');item.model.bytes--;candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE].version=4;expect(validateWorkspaceFurnishings(candidate).errors[0]?.code).toBe('FRAME_ASSET_UNSUPPORTED');candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE].version=5;
 const p='10000000-0000-4000-8000-0000000000a4';placement.id=p;candidate.extensions[WORKSPACE_FURNISHING_NAMESPACE].frameAttachments[0]!.placementId=p;
 const conflict={...candidate,extensions:{...candidate.extensions,'org.exhibitos.studio/installation':{placements:[{placementId:p.toUpperCase(),frame:{kind:'flat'}}]}}};expect(validateWorkspaceFurnishings(conflict).errors[0]?.code).toBe('FRAME_PROCEDURAL_CONFLICT');
});

it('requires explicit capability for the exact frame preparation policy',()=>{
 const request={...base,kind:'artwork-frame',preparationPolicy:'omit-unused-invalid-tangent-r1'};
 expect(validWorkspaceFurnishingDeclaration(request,{allowArtworkFrame:true})).toBe(false);
 expect(validWorkspaceFurnishingDeclaration(request,{allowArtworkFrame:true,allowFramePreparation:true})).toBe(true);
 expect(validWorkspaceFurnishingDeclaration({...request,preparationPolicy:'other'},{allowArtworkFrame:true,allowFramePreparation:true})).toBe(false);
 expect(validWorkspaceFurnishingDeclaration({...request,kind:'pedestal'},{allowFramePreparation:true})).toBe(false);
});

it('requires its own capability for an info-stand source preparation request',()=>{
 const preparationPolicy='normalize-legacy-sign-texture-r1';
 const request={...base,kind:'info-stand',preparationPolicy};
 const enabled={allowRoomVisual:true,allowInfoStandPreparation:true};
 expect(validWorkspaceFurnishingDeclaration(request,enabled)).toBe(true);
 expect(validWorkspaceFurnishingDeclaration(request,{allowRoomVisual:true,allowFramePreparation:true})).toBe(false);
 expect(validWorkspaceFurnishingDeclaration(request,{allowInfoStandPreparation:true})).toBe(false);
 expect(validWorkspaceFurnishingDeclaration({...request,kind:'barrier'},enabled)).toBe(false);
 expect(validWorkspaceFurnishingDeclaration({...request,fitProfile:'straight-ring-v1'},enabled)).toBe(false);
 expect(validWorkspaceFurnishingDeclaration({...base,kind:'info-stand'}, {allowRoomVisual:true})).toBe(true);
});

it('binds the fixed portal only to a compatible existing door',async()=>{
 const {validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE}=await import('./workspace-furnishing.ts');
 const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,sha='385a3a6d5266a5dda5b3fc6e51fd14e0b990e29de66ee27a80b634a93ef2591b',pose={position:[0,1.5,0],rotation:[0,0,0,1],scale:[1,1,1]};
 const candidate={rooms:[{id:id(1),dimensions:{width:6,height:3,depth:8},transform:structuredClone(pose)}],surfaces:[{id:id(3),roomId:id(1),type:'wall',transform:structuredClone(pose)}],openings:[{id:id(4),surfaceId:id(3),type:'door',dimensions:{width:2.4,height:2.6},offset:[0,-.2]}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:6,furnishings:[{id:id(2),version:1,kind:'portal-finish',name:'Portal',rights:{},provenance:'Synthetic',model:{mime:'model/gltf-binary',bytes:164044,sha256:sha}}],placements:[],frameAttachments:[],openingAttachments:[{openingId:id(4),furnishingId:id(2),furnishingVersion:1,modelSha256:sha}]}}};
 expect(validateWorkspaceFurnishings(candidate).valid).toBe(true);candidate.openings[0]!.dimensions.width=2.3;expect(validateWorkspaceFurnishings(candidate).errors[0]?.code).toBe('PORTAL_SIZE_UNSUPPORTED');candidate.openings[0]!.dimensions.width=2.4;candidate.openings[0]!.offset[1]=0;expect(validateWorkspaceFurnishings(candidate).errors[0]?.code).toBe('PORTAL_TRANSFORM_UNSUPPORTED');candidate.openings[0]!.offset[1]=-.2;candidate.openings=[];expect(validateWorkspaceFurnishings(candidate).errors[0]?.code).toBe('PORTAL_TARGET_STALE');
});

it('admits the distinct miter profile only with source-bound capability and envelope9',async()=>{
 const {validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE}=await import('./workspace-furnishing.ts');
 const request={...base,kind:'artwork-frame',fitProfile:'straight-miter-ring-v1'},options={allowArtworkFrame:true,allowReusableFit:true};expect(validWorkspaceFurnishingDeclaration(request,options)).toBe(true);expect(validWorkspaceFurnishingDeclaration(request,{allowArtworkFrame:true})).toBe(false);expect(validWorkspaceFurnishingDeclaration({...request,preparationPolicy:'omit-unused-invalid-tangent-r1'},options)).toBe(false);expect(validWorkspaceFurnishingDeclaration({...request,fit:{version:1}},options)).toBe(false);
 const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,transform={scale:[1,1,1]},model=base.model,fit={version:1,sourceSha256:model.sha256,sourceBytes:model.bytes,geometry:{profile:'straight-miter-ring-v1',openingWidth:.6,openingHeight:.8,imagePlaneZ:-.012}},item={id:id(2),version:1,kind:'artwork-frame',name:'Synthetic',rights:{},provenance:'Synthetic',model,fit};
 const ext={version:9,furnishings:[item],placements:[],openingAttachments:[],frameAttachments:[{placementId:id(4),artworkRevisionId:id(5),assetId:id(6),furnishingId:id(2),furnishingVersion:1,modelSha256:model.sha256}]};
 const candidate={rooms:[{id:id(1),dimensions:{width:6,height:3,depth:8},transform}],placements:[{id:id(4),roomId:id(1),artworkRevisionId:id(5),assetId:id(6),transform}],artworks:[{revisionId:id(5),primaryAssetId:id(6),schemaVersion:'1.0.0-draft.1',artworkType:'image',dimensions:{width:.934,height:.732},transform}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:ext}};
 expect(validateWorkspaceFurnishings(candidate).valid).toBe(true);ext.version=7;expect(validateWorkspaceFurnishings(candidate).valid).toBe(false);ext.version=8;expect(validateWorkspaceFurnishings(candidate).valid).toBe(false);ext.version=9;fit.sourceBytes++;expect(validateWorkspaceFurnishings(candidate).valid).toBe(false);
});
