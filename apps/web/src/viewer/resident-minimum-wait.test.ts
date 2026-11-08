import {expect,it} from 'vitest';
import {residentDemandActive,residentMinimumFits,retryResidentMinimum,sameResidentMinimumAsset} from './resident-minimum-wait';

it('waits for actual tracked capacity before retrying a discarded minimum',()=>{
 const used=69597718,required=125357442,limit=165510282;
 expect(residentMinimumFits(used,required,limit)).toBe(false);
 expect(residentMinimumFits(used-29444878,required,limit)).toBe(true);
 expect(residentMinimumFits(used,required,limit+29444878)).toBe(true);
 expect(residentMinimumFits(NaN,required,limit)).toBe(false);
 expect(residentMinimumFits(Number.MAX_SAFE_INTEGER,1,Number.MAX_SAFE_INTEGER)).toBe(false);
});

it('does not apply a discarded full model requirement to a different selected variant',()=>{
 expect(sameResidentMinimumAsset('A0','a0')).toBe(true);
 expect(sameResidentMinimumAsset('a0','b0')).toBe(false);
 expect(sameResidentMinimumAsset('a0',undefined)).toBe(false);
});

it('does not recover cancelled, hidden, stopped, disposed or lost wall demand',()=>{
 const active={cancelled:false,disposed:false,gpuLost:false,publicDisplayStopped:false,observeWall:true,automatic:true,immersive:false};
 expect(residentDemandActive(active)).toBe(true);
 for(const change of [{automatic:false},{observeWall:false},{disposed:true},{gpuLost:true},{publicDisplayStopped:true}])expect(residentDemandActive({...active,...change})).toBe(false);
 expect(residentDemandActive({...active,automatic:false,immersive:true})).toBe(true);
 expect(residentDemandActive({...active,automatic:false,immersive:true,cancelled:true})).toBe(false);
});

it('reclaims newly eligible resources before retry, but ignores cancelled demand and pending work',()=>{
 let used=69597718,reclaimable=0,calls=0;
 const input={required:125357442,needed:true,pending:false,used:()=>used,limit:()=>165510282,reclaim:(deficit:()=>number)=>{calls++;if(reclaimable>=deficit())used-=reclaimable;}};
 expect(retryResidentMinimum(input)).toBe(false);
 reclaimable=29444878;
 expect(retryResidentMinimum({...input,needed:false})).toBe(false);
 expect(retryResidentMinimum({...input,pending:true})).toBe(false);
 expect(calls).toBe(1);
 expect(retryResidentMinimum(input)).toBe(true);
 expect(used).toBe(40152840);
});
