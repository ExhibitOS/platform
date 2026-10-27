// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {materialMapPlan,type MaterialMapCost} from './material-texture-plan';
const files:MaterialMapCost[]=[{role:'color',bytes:1810870,width:2048,height:2048},{role:'normal',bytes:2397933,width:2048,height:2048},{role:'roughness',bytes:700000,width:2048,height:2048}];
test('desktop reserves full original decoding and all roles with separate scalar resolution',()=>{
 const plan=materialMapPlan(files,2048,96*1024*1024);
 expect(plan.blocked).toBe(false);expect(plan.sizes).toHaveLength(3);
 expect(plan.sizes[0]).toBe(plan.sizes[1]);expect(plan.sizes[2]).toBe(plan.sizes[0]!/2);
 expect(plan.reserveBytes).toBeLessThanOrEqual(Math.floor(96*1024*1024*.65));
 expect(plan.reserveBytes-plan.residentBytes).toBeGreaterThanOrEqual(2048*2048*4+3*2397933);
});
test('a mobile budget never hides the cost of decoding a full original or drops a role',()=>{
 const plan=materialMapPlan(files,512,24*1024*1024);
 expect(plan).toEqual({sizes:[],reserveBytes:0,residentBytes:0,blocked:true});
 expect(materialMapPlan([],512,1)).toEqual({sizes:[],reserveBytes:0,residentBytes:0,blocked:false});
 expect(materialMapPlan(files,NaN,1).blocked).toBe(true);
});
