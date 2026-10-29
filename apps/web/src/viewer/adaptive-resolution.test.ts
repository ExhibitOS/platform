// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, it } from 'vitest';
import { AdaptiveResolution } from './adaptive-resolution';

it('steps down after sustained motion and recovers only after a longer stable interval',()=>{
 const policy=new AdaptiveResolution();let now=0;
 for(let i=0;i<74;i++){now+=40;expect(policy.sample(now,40,true,false)).toBe(false);}
 now+=40;expect(policy.sample(now,40,true,false)).toBe(true);expect(policy.scale).toBe(.85);
 for(let i=0;i<499;i++){now+=16;expect(policy.sample(now,16,true,false)).toBe(false);}
 now+=16;expect(policy.sample(now,16,true,false)).toBe(true);expect(policy.scale).toBe(1);
});
it('ignores interrupted or isolated gaps but adapts to persistently severe motion frames',()=>{
 const policy=new AdaptiveResolution();let now=0;
 for(let i=0;i<14;i++){now+=200;expect(policy.sample(now,200,true,false)).toBe(false);}
 now+=200;expect(policy.sample(now,200,true,false)).toBe(true);expect(policy.scale).toBe(.85);
 policy.reset();now+=200;policy.sample(now,200,true,false);now+=16;policy.sample(now,16,true,false);
 for(let i=0;i<14;i++){now+=200;policy.sample(now,200,true,false);}
 now+=200;policy.sample(now,200,true,true);expect(policy.scale).toBe(.85);
 now+=2000;policy.sample(now,2000,true,false);expect(policy.scale).toBe(.85);
});
