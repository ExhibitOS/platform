// SPDX-License-Identifier: AGPL-3.0-or-later
import type {WorkspaceFurnishingDescriptor,WorkspaceFurnishings} from '@exhibitos/studio-contract';
import type {PublicAsset} from '../publication-client';
import type {WorkspaceModelSource} from './model-loader';
import {publicWorkspaceFurnishingRights} from './public-rights.mjs';
import type {PublicWorkspaceCache} from './public-cache';

/** The URL is selected only from the checked immutable publication inventory. */
export function publicWorkspaceModelSource(publicationId:string,revisionSha256:string,assets:PublicAsset[],extension:WorkspaceFurnishings,descriptor:WorkspaceFurnishingDescriptor,fetcher:typeof fetch,checkPublication:()=>Promise<void>,cache?:PublicWorkspaceCache):WorkspaceModelSource{
 const expected=`/api/v1/publications/${publicationId}/assets/${descriptor.id}`,matches=assets.filter(item=>item.assetId===descriptor.id);
 if(!/^[a-f0-9]{64}$/.test(revisionSha256)||matches.length!==1||matches[0]!.mime!==descriptor.model.mime||matches[0]!.url!==expected||!extension.furnishings.some(item=>item.id===descriptor.id&&item.version===descriptor.version))throw Error('WORKSPACE_MODEL_AUTHORITY');
 const key=`workspace-furnishing:${publicationId}:${revisionSha256}:${descriptor.id}:${descriptor.version}:${descriptor.model.sha256}`;
 return {async check(){if(!publicWorkspaceFurnishingRights(extension))throw Error('WORKSPACE_MODEL_AUTHORITY');await checkPublication();if(!publicWorkspaceFurnishingRights(extension))throw Error('WORKSPACE_MODEL_AUTHORITY');},async open(signal){const response=await fetcher(expected,{credentials:'omit',redirect:'error',cache:'no-store',signal});if(response.headers.get('x-exhibitos-publication-revision')!==revisionSha256){await response.body?.cancel().catch(()=>{});throw Error('WORKSPACE_MODEL_AUTHORITY');}return response;},...(cache?{cached:()=>cache.get(key),remember:(bytes:ArrayBuffer)=>cache.put(key,bytes)}:{})};
}
