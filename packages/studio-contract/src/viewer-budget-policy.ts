// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
export const VIEWER_BUDGET_NAMESPACE='org.exhibitos.studio/viewer-budget';
export const VIEWER_BUDGET_POLICY_VERSION=1 as const;
export const VIEWER_BUDGET_ACCOUNTING_VERSION=1 as const;
export const VIEWER_BUDGET_PROFILES=['standard','compact','native'] as const;
export const VIEWER_BUDGET_METRICS=['colorDraws','displayTriangles','shadowCasterTriangles','shadowDepthTriangles','residentBytes','transitionBytes'] as const;
export type ViewerBudgetProfile=typeof VIEWER_BUDGET_PROFILES[number];
export type ViewerBudgetTargetProfile='auto'|'standard'|'compact';
export type ViewerBudgetMetric=typeof VIEWER_BUDGET_METRICS[number];
export type ViewerBudgetLimits=Record<ViewerBudgetMetric,number>;
export type ViewerBudgetOverrides={warning?:Partial<ViewerBudgetLimits>;admission?:Partial<ViewerBudgetLimits>};
export type ViewerBudgetPolicy={version:1;policyVersion:1;profiles:Partial<Record<ViewerBudgetProfile,ViewerBudgetOverrides>>;targetProfile?:ViewerBudgetTargetProfile};
export type ResolvedViewerBudgetPolicy={policyVersion:1;accountingVersion:1;profile:ViewerBudgetProfile;recommended:ViewerBudgetLimits;warning:ViewerBudgetLimits;admission:ViewerBudgetLimits;overrides:ViewerBudgetOverrides;recommendationSource:'profile-default'|'runtime-input'};
export type ViewerBudgetContributor={id:string;label:string;roomId?:string;usage:Partial<Record<ViewerBudgetMetric,number|null>>};
export type ViewerBudgetUsage={scope:'wholeExhibition'|'currentView'|'analyzedSection';complete:boolean;colorDraws:number|null;displayTriangles:number|null;shadowCasterTriangles:number|null;shadowDepthTriangles:number|null;residentBytes:number|null;transitionBytes:number|null;contributors:ViewerBudgetContributor[];assumptions?:string[]};
export type ViewerBudgetStatus='within'|'warning'|'admission-exceeded'|'unknown';
export type ViewerBudgetDecision={metric:ViewerBudgetMetric;value:number|null;warning:number;admission:number;remaining:number|null;status:ViewerBudgetStatus};
export type ViewerBudgetEvaluation={policyVersion:1;accountingVersion:1;profile:ViewerBudgetProfile;scope:ViewerBudgetUsage['scope'];complete:boolean;status:ViewerBudgetStatus;metrics:ViewerBudgetDecision[];warnings:ViewerBudgetMetric[];admissionExceeded:ViewerBudgetMetric[];unknown:ViewerBudgetMetric[]};
const MiB=1024*1024;
const base=(displayTriangles:number,residentBytes:number,transitionBytes:number):ViewerBudgetLimits=>({colorDraws:384,displayTriangles,shadowCasterTriangles:250000,shadowDepthTriangles:250000,residentBytes,transitionBytes});
/** Starting product recommendations, not physical VRAM or hardware throughput. */
export const VIEWER_BUDGET_RECOMMENDATIONS:Readonly<Record<ViewerBudgetProfile,Readonly<ViewerBudgetLimits>>>=Object.freeze({standard:Object.freeze(base(350000,96*MiB,96*MiB)),compact:Object.freeze(base(250000,32*MiB,32*MiB)),native:Object.freeze(base(350000,320*MiB,416*MiB))});
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const only=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).every(k=>keys.includes(k));
const numeric=(v:unknown,min:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const limits=(v:unknown,min:number)=>object(v)&&only(v,VIEWER_BUDGET_METRICS)&&Object.values(v).every(n=>numeric(n,min));
const validOverrides=(v:unknown)=>object(v)&&only(v,['warning','admission'])&&(v.warning===undefined||limits(v.warning,0))&&(v.admission===undefined||limits(v.admission,1));
export function validateViewerBudgetPolicy(document:Pick<Exhibition,'extensions'>){
 const value=document.extensions?.[VIEWER_BUDGET_NAMESPACE];
 if(value===undefined)return {valid:true,errors:[] as {code:string;path:string}[]};
 const valid=object(value)&&only(value,['version','policyVersion','profiles','targetProfile'])&&value.version===1&&value.policyVersion===1&&object(value.profiles)&&only(value.profiles,VIEWER_BUDGET_PROFILES)&&Object.values(value.profiles).every(validOverrides)&&(value.targetProfile===undefined||['auto','standard','compact'].includes(value.targetProfile as string));
 return {valid,errors:valid?[]:[{code:'VIEWER_BUDGET_POLICY_INVALID',path:'/extensions/org.exhibitos.studio~1viewer-budget'}]};
}
export function viewerBudgetPolicyFor(document:Pick<Exhibition,'extensions'>):ViewerBudgetPolicy {
 if(!validateViewerBudgetPolicy(document).valid)throw Error('VIEWER_BUDGET_POLICY_INVALID');
 return structuredClone((document.extensions?.[VIEWER_BUDGET_NAMESPACE]??{version:1,policyVersion:1,profiles:{}}) as unknown as ViewerBudgetPolicy);
}
export function setViewerBudgetOverrides(document:Exhibition,profile:ViewerBudgetProfile,overrides:ViewerBudgetOverrides|null):Exhibition {
 if(!VIEWER_BUDGET_PROFILES.includes(profile)||overrides!==null&&!validOverrides(overrides))throw Error('VIEWER_BUDGET_POLICY_INVALID');
 const next=structuredClone(document),policy=viewerBudgetPolicyFor(next);
 const cleaned=overrides===null?undefined:Object.fromEntries(Object.entries(overrides).filter(([,values])=>Object.keys(values??{}).length)) as ViewerBudgetOverrides;
 if(cleaned&&Object.keys(cleaned).length)policy.profiles[profile]=structuredClone(cleaned);else delete policy.profiles[profile];
 if(Object.keys(policy.profiles).length||policy.targetProfile&&policy.targetProfile!=='auto')next.extensions={...next.extensions,[VIEWER_BUDGET_NAMESPACE]:policy as unknown as NonNullable<Exhibition['extensions']>[string]};
 else if(next.extensions){delete next.extensions[VIEWER_BUDGET_NAMESPACE];if(!Object.keys(next.extensions).length)delete next.extensions;}
 return next;
}
export function setViewerBudgetPolicy(document:Exhibition,policy:ViewerBudgetPolicy|null):Exhibition {
 const next=resetViewerBudgetPolicy(document);if(policy===null)return next;
 if(!validateViewerBudgetPolicy({extensions:{[VIEWER_BUDGET_NAMESPACE]:policy} as unknown as Exhibition['extensions']}).valid)throw Error('VIEWER_BUDGET_POLICY_INVALID');
 const copy=structuredClone(policy);if(copy.targetProfile==='auto')delete copy.targetProfile;
 if(Object.keys(copy.profiles).length||copy.targetProfile)next.extensions={...next.extensions,[VIEWER_BUDGET_NAMESPACE]:copy as unknown as NonNullable<Exhibition['extensions']>[string]};
 return next;
}
export function setViewerBudgetTargetProfile(document:Exhibition,targetProfile:ViewerBudgetTargetProfile):Exhibition {
 if(!['auto','standard','compact'].includes(targetProfile))throw Error('VIEWER_BUDGET_PROFILE_INVALID');
 const policy=viewerBudgetPolicyFor(document);policy.targetProfile=targetProfile;return setViewerBudgetPolicy(document,policy);
}
export function selectViewerBudgetProfile(document:Pick<Exhibition,'extensions'>,input:{nativeEditor:boolean;automaticProfile:'standard'|'compact';requestedProfile?:ViewerBudgetProfile}) {
 const storedTargetProfile=viewerBudgetPolicyFor(document).targetProfile??'auto';
 if(typeof input.nativeEditor!=='boolean'||!['standard','compact'].includes(input.automaticProfile)||input.requestedProfile!==undefined&&!VIEWER_BUDGET_PROFILES.includes(input.requestedProfile))throw Error('VIEWER_BUDGET_PROFILE_INVALID');
 const effectiveProfile:ViewerBudgetProfile=input.requestedProfile??(input.nativeEditor?'native':storedTargetProfile==='auto'?input.automaticProfile:storedTargetProfile);
 return {storedTargetProfile,requestedProfile:input.requestedProfile??null,effectiveProfile,selection:input.requestedProfile?'request' as const:input.nativeEditor?'native-editor' as const:storedTargetProfile==='auto'?'automatic' as const:'exhibition-target' as const};
}
export function resetViewerBudgetPolicy(document:Exhibition):Exhibition {
 const next=structuredClone(document);if(next.extensions){delete next.extensions[VIEWER_BUDGET_NAMESPACE];if(!Object.keys(next.extensions).length)delete next.extensions;}return next;
}
/** Runtime recommendation input is the existing device-policy selection. It is
 * explicit analysis provenance, never a stored override or hardware capacity. */
export function resolveViewerBudgetPolicy(document:Pick<Exhibition,'extensions'>,profile:ViewerBudgetProfile,recommendedBaseline?:Partial<ViewerBudgetLimits>):ResolvedViewerBudgetPolicy {
 if(!VIEWER_BUDGET_PROFILES.includes(profile)||recommendedBaseline!==undefined&&!limits(recommendedBaseline,1))throw Error('VIEWER_BUDGET_PROFILE_INVALID');
 const recommended={...VIEWER_BUDGET_RECOMMENDATIONS[profile],...recommendedBaseline},overrides=viewerBudgetPolicyFor(document).profiles[profile]??{};
 const admission={...recommended,...overrides.admission};
 const warning=Object.fromEntries(VIEWER_BUDGET_METRICS.map(key=>[key,Math.floor(admission[key]*.8)])) as ViewerBudgetLimits;
 Object.assign(warning,overrides.warning);
 return {policyVersion:1,accountingVersion:1,profile,recommended,admission,warning,overrides:structuredClone(overrides),recommendationSource:recommendedBaseline===undefined?'profile-default':'runtime-input'};
}
/** Renderer/accounting supplies facts. Null or incomplete lower bounds must not
 * become zero or an all-exhibition fit claim. This function never changes data. */
export function evaluateViewerBudgetUsage(policy:ResolvedViewerBudgetPolicy,usage:ViewerBudgetUsage):ViewerBudgetEvaluation {
 if(policy.policyVersion!==1||policy.accountingVersion!==1||!['wholeExhibition','currentView','analyzedSection'].includes(usage.scope)||typeof usage.complete!=='boolean'||!Array.isArray(usage.contributors)||!VIEWER_BUDGET_METRICS.every(key=>usage[key]===null||numeric(usage[key],0)))throw Error('VIEWER_BUDGET_USAGE_INVALID');
 const metrics=VIEWER_BUDGET_METRICS.map(metric=>{
  const value=usage[metric],admission=policy.admission[metric],warning=policy.warning[metric];
  const status:ViewerBudgetStatus=value===null?'unknown':value>admission?'admission-exceeded':!usage.complete?'unknown':value>=warning?'warning':'within';
  return {metric,value,admission,warning,remaining:value===null?null:admission-value,status};
 });
 const warnings=metrics.filter(m=>m.value!==null&&m.value>=m.warning&&m.value<=m.admission).map(m=>m.metric),admissionExceeded=metrics.filter(m=>m.status==='admission-exceeded').map(m=>m.metric),unknown=metrics.filter(m=>m.status==='unknown').map(m=>m.metric);
 return {policyVersion:1,accountingVersion:1,profile:policy.profile,scope:usage.scope,complete:usage.complete,status:admissionExceeded.length?'admission-exceeded':unknown.length?'unknown':warnings.length?'warning':'within',metrics,warnings,admissionExceeded,unknown};
}
