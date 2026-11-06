// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {buildApp} from './app.ts';
import {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';
import {createSelectedNativeUploadSlot} from './native-bounded-oex-upload.ts';
import {createSelectedStudioPutSlot} from './native-selected-studio-put.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
it('keeps selected workspace material access private and bound to the exact native owner and blob store',async()=>{
 const pool={} as Pool,blobs=new FileBlobStore('/synthetic-unused'),owner={workspaceId:id(1),tenantId:id(2),principalId:id(3),workspaceMaterials:true,assertCatalog:async()=>{},assertDatabase:async()=>{},assertRecord:async()=>{}},service=new WorkspaceMaterialIntakes(blobs,owner,()=>({valid:true,errors:[]})),auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},options={pool,blobs,auth,nativeOexWorkspace:owner,freshOexTest:true as const,uploadSlot:createSelectedNativeUploadSlot(),saveSlot:createSelectedStudioPutSlot(),selectedWorkspaceMaterial:service};
 const app=buildApp(options);try{const response=await app.inject({method:'GET',url:`/api/v1/tenants/${id(2)}/workspace/materials`});expect(response.statusCode).toBe(404);}finally{await app.close();}
 expect(()=>buildApp({...options,selectedWorkspaceMaterial:new WorkspaceMaterialIntakes(new FileBlobStore('/other'),owner,()=>({valid:true,errors:[]}))})).toThrow('WORKSPACE_MATERIAL_CONFIGURATION');
 expect(()=>buildApp({...options,freshOexTest:undefined})).toThrow('WORKSPACE_MATERIAL_CONFIGURATION');
 expect(()=>buildApp({...options,workspaceMaterial:service})).toThrow('WORKSPACE_MATERIAL_CONFIGURATION');
});
