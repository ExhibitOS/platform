// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {TEMPLATE_NAMESPACE,INSTALLATION_NAMESPACE,installationFor,setLightDetails,type InstallationPedestal,type StudioInstallation,
 type ExhibitionLight,type LightDetails} from '@exhibitos/studio-contract';

/** The existing installation and light-details representations, applied to one
 * saved candidate. The caller authenticates its owner and validates the complete
 * base and result. No draft, asset, rights or save operation is accepted here. */
export type NativeSceneCommand=
 |{type:'set-pedestal';placementId:string;pedestal:InstallationPedestal}
 |{type:'add-light';light:ExhibitionLight;settings?:Omit<LightDetails,'lightId'>}
 |{type:'set-light-details';lightId:string;light:Omit<ExhibitionLight,'id'>;settings:Omit<LightDetails,'lightId'>};

export function nativeSceneProposal(candidate:Exhibition,command:NativeSceneCommand){
 if(command.type==='set-light-details')return {lightId:command.lightId,candidate:setLightDetails(candidate,command.lightId,command.light,command.settings)};
 const next=structuredClone(candidate);
 if(command.type==='add-light'){
  if(next.lights.some(light=>light.id.toLowerCase()===command.light.id.toLowerCase()))throw Error('LIGHT_ALREADY_EXISTS');
  next.lights.push(structuredClone(command.light));
  if(next.extensions?.[TEMPLATE_NAMESPACE]){const template=next.extensions[TEMPLATE_NAMESPACE] as unknown as {modified:boolean};template.modified=true;}
  const {id,...light}=command.light;
  return {lightId:id,candidate:command.settings?setLightDetails(next,id,light,command.settings):next};
 }
 const placement=next.placements.find(item=>item.id.toLowerCase()===command.placementId.toLowerCase());
 if(!placement)throw Error('INSTALLATION_REFERENCE');
 const installation=next.extensions?.[INSTALLATION_NAMESPACE] as unknown as StudioInstallation|undefined;
 const placements=structuredClone(installation?.placements??[]);
 const index=placements.findIndex(item=>item.placementId.toLowerCase()===placement.id.toLowerCase());
 const binding={...installationFor(next,placement.id),placementId:placement.id,pedestal:structuredClone(command.pedestal)};
 if(index<0)placements.push(binding);else placements[index]=binding;
 next.extensions={...next.extensions,[INSTALLATION_NAMESPACE]:{version:1,placements} as unknown as NonNullable<Exhibition['extensions']>[string]};
 return {placementId:placement.id,candidate:next};
}
