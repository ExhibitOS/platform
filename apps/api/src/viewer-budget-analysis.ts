// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import type {ViewerBudgetGeometryResult} from '@exhibitos/studio-contract';
import type {Exhibition} from '@exhibitos/spec';
import {freezeCanonical,viewerBudgetPolicyFor,selectViewerBudgetProfile,resolveViewerBudgetPolicy,evaluateViewerBudgetUsage,VIEWER_BUDGET_METRICS,type ViewerBudgetProfile,type ViewerBudgetLimits,type ViewerBudgetUsage} from '@exhibitos/studio-contract';
import {ApiError} from './api-error.ts';
export type ViewerBudgetAnalysisOptions={profile?:ViewerBudgetProfile;context?:'viewer'|'native';automaticProfile?:'standard'|'compact';recommendedBaseline?:Partial<ViewerBudgetLimits>;observations?:ViewerBudgetObservation[]};
export type ViewerBudgetObservation={inputSHA256:string;policySHA256:string;policyVersion:1;accountingVersion:1;profile:ViewerBudgetProfile;usage:ViewerBudgetUsage};
export type ViewerBudgetAnalysisBinding={exhibitionId:string;savedRevision:number;etag:string;draftId:string;draftEditVersion:number;source:'saved'|'draft'};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const only=(value:Record<string,unknown>,keys:readonly string[])=>Object.keys(value).every(k=>keys.includes(k));
const numeric=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export const viewerBudgetSHA256=(value:unknown)=>createHash('sha256').update(freezeCanonical(value)).digest('hex');
/** Declared inventory is neither a decoded allocation nor current-view traffic.
 * Both counts are explicit: references versus content deduplicated by digest. */
export function viewerBudgetDeclaredInventory(candidate:Exhibition){
 const entries:{id:string;label:string;sha256:string;bytes:number;path?:string;mime?:string}[]=[],contents=new Map<string,number>();let inconsistent=false;
 const visit=(value:unknown,path:string)=>{
  if(Array.isArray(value)){value.forEach((v,i)=>visit(v,path+'/'+i));return;}
  if(!object(value))return;
  if(typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256)&&numeric(value.bytes)){
   const bytes=value.bytes as number;const prior=contents.get(value.sha256);if(prior!==undefined&&prior!==bytes)inconsistent=true;else contents.set(value.sha256,bytes);
   entries.push({id:path,label:typeof value.path==='string'?value.path:path,sha256:value.sha256,bytes,...(typeof value.path==='string'?{path:value.path}:{}),...(typeof value.mime==='string'?{mime:value.mime}:{})});
  }
  for(const [key,nested]of Object.entries(value))visit(nested,path+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'));
 };
 visit(candidate,'/candidate');
 const sum=(values:Iterable<number>)=>{let n=0;for(const value of values){n+=value;if(!Number.isSafeInteger(n))return null;}return n;};
 return {scope:'declaredInventory' as const,declaredResourceCount:entries.length,uniqueContentCount:contents.size,declaredResourceBytes:inconsistent?null:sum(entries.map(e=>e.bytes)),uniqueContentBytes:inconsistent?null:sum(contents.values()),downloadBytes:null,decodedResidentBytes:null,complete:false,contributors:entries.sort((a,b)=>b.bytes-a.bytes||a.id.localeCompare(b.id)),assumptions:['Counts cover declared SHA-256/byte records, including retained variants, notices and previews.','Content deduplication is not a guarantee of URL caching or network transfer.','Undeclared embedded resources, decoded textures, renderer geometry and current-view traffic have not been inspected.'],issues:inconsistent?['DECLARED_RESOURCE_METADATA_CONFLICT']:[]};
}
function checkedObservation(value:unknown):ViewerBudgetObservation {
 if(!object(value)||!only(value,['inputSHA256','policySHA256','policyVersion','accountingVersion','profile','usage'])||value.policyVersion!==1||value.accountingVersion!==1||typeof value.inputSHA256!=='string'||!/^[a-f0-9]{64}$/.test(value.inputSHA256)||typeof value.policySHA256!=='string'||!/^[a-f0-9]{64}$/.test(value.policySHA256)||!object(value.usage))throw new ApiError(422,'VIEWER_BUDGET_OBSERVATION_INVALID');
 const u=value.usage;
 if(!only(u,['scope','complete',...VIEWER_BUDGET_METRICS,'contributors','assumptions'])||!Array.isArray(u.contributors)||u.assumptions!==undefined&&(!Array.isArray(u.assumptions)||!u.assumptions.every(x=>typeof x==='string')))throw new ApiError(422,'VIEWER_BUDGET_OBSERVATION_INVALID');
 for(const c of u.contributors)if(!object(c)||!only(c,['id','label','roomId','usage'])||typeof c.id!=='string'||typeof c.label!=='string'||c.roomId!==undefined&&typeof c.roomId!=='string'||!object(c.usage)||!only(c.usage,VIEWER_BUDGET_METRICS)||!Object.values(c.usage).every(v=>v===null||numeric(v)))throw new ApiError(422,'VIEWER_BUDGET_OBSERVATION_INVALID');
 return value as unknown as ViewerBudgetObservation;
}
/** Advisory observations never become server-verified asset facts or a new
 * output/permission grant. Export validity remains its existing independent check. */
export function analyzeViewerBudget(candidate:Exhibition,binding:ViewerBudgetAnalysisBinding,options:ViewerBudgetAnalysisOptions={},producer?:ViewerBudgetGeometryResult|null) {
 if(!object(options)||!only(options,['profile','context','automaticProfile','recommendedBaseline','observations'])||options.context!==undefined&&!['viewer','native'].includes(options.context)||options.observations!==undefined&&!Array.isArray(options.observations))throw new ApiError(422,'VIEWER_BUDGET_ANALYSIS_INPUT_INVALID');
 let selection,policy,resolvedPolicy;
 try{policy=viewerBudgetPolicyFor(candidate);selection=selectViewerBudgetProfile(candidate,{nativeEditor:options.context==='native',automaticProfile:options.automaticProfile===undefined?'standard':options.automaticProfile,...(options.profile!==undefined?{requestedProfile:options.profile}:{})});resolvedPolicy=resolveViewerBudgetPolicy(candidate,selection.effectiveProfile,options.recommendedBaseline);}catch{throw new ApiError(422,'VIEWER_BUDGET_POLICY_INVALID');}
 const inputSHA256=viewerBudgetSHA256(candidate),policySHA256=viewerBudgetSHA256(resolvedPolicy);
 const observations=(options.observations??[]).map(value=>{
  const observation=checkedObservation(value);
  if(observation.inputSHA256!==inputSHA256||observation.policySHA256!==policySHA256||observation.profile!==selection.effectiveProfile)throw new ApiError(412,'VIEWER_BUDGET_ANALYSIS_STALE');
  try{return {basis:'client-renderer-observation' as const,serverVerifiedAssetFacts:false,usage:observation.usage,evaluation:evaluateViewerBudgetUsage(resolvedPolicy,observation.usage)};}catch{throw new ApiError(422,'VIEWER_BUDGET_OBSERVATION_INVALID');}
 });
 if(producer&&(producer.accountingVersion!==1||producer.profile!==selection.effectiveProfile||producer.wholeExhibition.scope!=='wholeExhibition'||producer.analyzedSections.some(x=>x.scope!=='analyzedSection')))throw new ApiError(503,'VIEWER_BUDGET_PRODUCER_INVALID');
 const whole:ViewerBudgetUsage=producer?.wholeExhibition??{scope:'wholeExhibition',complete:false,colorDraws:null,displayTriangles:null,shadowCasterTriangles:null,shadowDepthTriangles:null,residentBytes:null,transitionBytes:null,contributors:[],assumptions:['Whole-exhibition renderer/decoded-resource facts have not been supplied by a verified producer. Metadata bytes are not substituted for them.']};
 return {version:1 as const,policyVersion:1 as const,accountingVersion:1 as const,binding:{...binding,inputSHA256},selection,policy,resolvedPolicy,policySHA256,inventory:viewerBudgetDeclaredInventory(candidate),estimates:{wholeExhibition:{basis:producer?'verified-cpu-producer' as const:'uninspected-document' as const,usage:whole,evaluation:evaluateViewerBudgetUsage(resolvedPolicy,whole)},currentView:observations.find(x=>x.usage.scope==='currentView')??null,analyzedSections:[...(producer?.analyzedSections??[]).map(usage=>({basis:'verified-cpu-producer' as const,serverVerifiedAssetFacts:true,usage,evaluation:evaluateViewerBudgetUsage(resolvedPolicy,usage)})),...observations.filter(x=>x.usage.scope==='analyzedSection')],otherReportedScopes:observations.filter(x=>x.usage.scope==='wholeExhibition')},analysisComplete:whole.complete&&VIEWER_BUDGET_METRICS.every(key=>whole[key]!==null),producerAssumptions:producer?.assumptions??[],exportConfiguration:{targetProfile:policy.targetProfile??'auto',performanceAdvisoryOnly:true,hardwareCapabilities:'not-measured' as const},remedies:['Request producer-bound geometry/resource analysis for uninspected sections.','Inspect a current view or heavier section without treating it as the whole exhibition.','Adjust this exhibition’s explicit policy or reset to recommendations; browser/GPU capabilities remain separate.']};
}
export type ViewerBudgetAnalysis=ReturnType<typeof analyzeViewerBudget>;
