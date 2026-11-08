// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {bindNativeDetailContext} from './native-detail-context.ts';
import {buildApp} from './app.ts';

it('rejects unissued owner and detail context objects before mounting any route',()=>{
 const owner={workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),assertDatabase:async()=>{}};
 expect(()=>bindNativeDetailContext(owner,randomUUID(),new AbortController().signal,()=>true)).toThrow('NATIVE_DETAIL_CONFIGURATION');
 const context={owner,runtimeGeneration:randomUUID(),signal:new AbortController().signal,live:()=>true},pool={} as Pool,auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 expect(()=>buildApp({pool,auth,blobs:new FileBlobStore('/synthetic-unused'),nativeExportWorkspace:owner,nativeDetailContext:context})).toThrow('NATIVE_DETAIL_CONFIGURATION');
});
