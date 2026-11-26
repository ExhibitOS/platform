// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {isWorkspaceFitReceipt,validWorkspaceFurnishingDeclaration,type WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import type {DefaultCatalogueItem,DefaultCatalogueFile} from './default-catalogue-update-plan.ts';
import {validRights,allowedRights} from './rights.ts';

export type PassiveStockRail = {descriptor:WorkspaceFurnishingDescriptor; model:DefaultCatalogueFile; notice:DefaultCatalogueFile};

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const closed=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

/** This class admits unchanged, publisher-owned passive meshes only.
 * An envelope is not a certificate for mounting an articulated head. */
export function passiveStockRail(row:Record<string,unknown>,item:DefaultCatalogueItem):PassiveStockRail|undefined {
 const {workspaceFurnishing:d,model,rights,provenance}=row;
 if(!closed(row,['catalogId','catalogVersion','name','hostKind','model','rights','provenance','workspaceFurnishing'])||
    row.hostKind!=='ceiling-rail'||item.version!==1||!object(d)||d.kind!=='ceiling-rail'||d.version!==1||
    !closed(d,['id','version','kind','name','model','rights','provenance','fit'])||d.name!==row.name||
    !object(model)||!object(rights)||!object(provenance)||!closed(provenance,['sourceSha256','recipe'])||
    !object(d.model)||!object(d.rights)||!validRights(d.rights)||d.rights.ownership!=='owner'||d.rights.holder!=='ExhibitOS'||
    d.rights.licenseId!=='CC0-1.0'||rights.licenseId!==d.rights.licenseId||
    !allowedRights(d.rights,'display')||!allowedRights(d.rights,'export')||
    !validWorkspaceFurnishingDeclaration({requestId:d.id,kind:d.kind,name:d.name,rights:d.rights,provenance:d.provenance,model:d.model},{allowCeilingRail:true}))return;
 const descriptor=d as unknown as WorkspaceFurnishingDescriptor;
 const {path,...modelDetails}=model;
 if(typeof path!=='string'||!path.startsWith('assets/furnishings/')||!path.endsWith('/'+item.id+'/model.glb')||
    !isDeepStrictEqual(modelDetails,descriptor.model)||provenance.recipe!=='original-v1'||provenance.sourceSha256!==descriptor.model.sha256||
    !isWorkspaceFitReceipt(d.fit,descriptor.model,'passive-ceiling-rail-v1'))return;
 const modelFile={path,bytes:descriptor.model.bytes,sha256:descriptor.model.sha256};
 const notice=item.files.find(file=>file.path===path.slice(0,-'model.glb'.length)+'LICENSE-NOTICE.txt');
 if(item.files.length!==2||!notice||notice.sha256===modelFile.sha256||!isDeepStrictEqual(rights.notice,notice)||
    !item.files.some(file=>isDeepStrictEqual(file,modelFile)))return;
 return {descriptor,model:modelFile,notice};
}
