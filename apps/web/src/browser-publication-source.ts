// SPDX-License-Identifier: AGPL-3.0-or-later
import {freezeCanonical} from '@exhibitos/studio-contract';
import type {PublicPublication} from './publication-client';
import {newDraft} from './drafts/example';
import {validateDraft} from './drafts/validator';
import {validFootstepPublication} from './viewer/footstep-publication';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const currentPublications=new WeakMap<PublicPublication,()=>boolean>();

/** The ordinary anonymous /p route only; server JSON cannot supply a local owner. */
export async function readBrowserPublication(id:string,isCurrent:()=>boolean):Promise<PublicPublication> {
  if(!uuid.test(id))throw Error('PUBLICATION_UNAVAILABLE');
  const response=await fetch(`/api/v1/publications/${id}?footsteps=1`,{
    credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000),
  });
  if(!response.ok)throw Error('PUBLICATION_UNAVAILABLE');
  const result=(await response.json()) as PublicPublication;
  const envelope=newDraft();
  envelope.schemaVersion=result.exhibition.schemaVersion;
  envelope.exhibitionId=result.exhibition.id;
  envelope.candidate=result.exhibition;
  if(result.publication.id!==id||result.publication.status!=='published'||
    !/^[a-f0-9]{64}$/.test(result.publication.revisionSha256)||!validateDraft(envelope).valid||
    !validFootstepPublication(result)||!Array.isArray(result.assets)||result.assets.some(asset=>
      !uuid.test(asset.assetId)||asset.url!==`/api/v1/publications/${id}/assets/${asset.assetId}`||
      !['image/png','model/gltf-binary','audio/wav'].includes(asset.mime)))throw Error('INVALID_PUBLICATION');
  const publication={publication:result.publication,exhibition:result.exhibition,assets:result.assets,
    ...(result.resources?{resources:result.resources}:{})};
  if(!result.exhibition.lights.some(light=>light.type==='spot'&&light.castsShadow===true))return publication;
  // Optional geometry evidence must not change ordinary admission.
  try{
    const {exhibition,assets}=publication,header=publication.publication;
    const revision=header.revisionSha256,canonical=freezeCanonical(exhibition),assetCount=assets.length;
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)));
    if(isCurrent()&&Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('')===revision){
      currentPublications.set(publication,()=>isCurrent()&&publication.publication===header&&header.id===id&&
        header.status==='published'&&header.revisionSha256===revision&&publication.exhibition===exhibition&&
        publication.assets===assets&&assets.length===assetCount);
    }
  }catch{/* Keep the ordinary route when optional geometry evidence is unavailable. */}
  return publication;
}

export function currentBrowserPublication(publication:PublicPublication,scene:PublicPublication['exhibition']){
  if(publication.local||publication.exhibition!==scene)return;
  const current=currentPublications.get(publication);
  if(current?.())return ()=>!publication.local&&current();
}
