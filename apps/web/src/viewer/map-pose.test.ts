// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {createMapPoseSource} from './map-pose';

it('delivers only changed real camera snapshots and exposes latest state without a frame loop',()=>{
 const source=createMapPoseSource('publication/revision'),listener=vi.fn(),unsubscribe=source.subscribe(listener);
 expect(source.getSnapshot()).toBeUndefined();source.publish([1,1.65,2],0,60);
 const first=source.getSnapshot();expect(first).toEqual({point:[1,2],direction:[-0,-1],horizontalFovDegrees:60});
 source.publish([1,1.65,2],0,60);expect(source.getSnapshot()).toBe(first);expect(listener).toHaveBeenCalledTimes(1);
 source.publish([1.001,1.65,2],.001,60);expect(listener).toHaveBeenCalledTimes(2);
 unsubscribe();source.publish([3,1.65,4],0,70);expect(listener).toHaveBeenCalledTimes(2);
 const resumed=vi.fn();const stop=source.subscribe(resumed);expect(source.getSnapshot()?.point).toEqual([3,4]);expect(resumed).not.toHaveBeenCalled();stop();
});

it('compares wraparound directions and commits teleports immediately without predicted intermediate poses',()=>{
 const source=createMapPoseSource('same/revision'),listener=vi.fn();source.subscribe(listener);
 source.publish([0,1,0],Math.PI,50);const before=source.getSnapshot();source.publish([0,1,0],-Math.PI,50);
 expect(source.getSnapshot()).toBe(before);expect(listener).toHaveBeenCalledTimes(1);
 source.publish([100,1,-40],-Math.PI+.02,50);expect(source.getSnapshot()?.point).toEqual([100,-40]);expect(listener).toHaveBeenCalledTimes(2);
});

it('keeps revision owners independent, rejects invalid input and clears disposed scene state once',()=>{
 const old=createMapPoseSource('pub/old'),next=createMapPoseSource('pub/new'),listener=vi.fn();old.subscribe(listener);
 old.publish([0,1,0],0,60);expect(next.key).toBe('pub/new');expect(next.getSnapshot()).toBeUndefined();
 for(const [position,yaw,fov] of [[[NaN,1,0],0,60],[[0,1,0],Infinity,60],[[0,1,0],0,0],[[0,1,0],0,180]] as [[number,number,number],number,number][])old.publish(position,yaw,fov);
 expect(old.getSnapshot()).toBeUndefined();expect(listener).toHaveBeenCalledTimes(2);
 old.publish([4,1,5],1,60);expect(old.getSnapshot()?.point).toEqual([4,5]);expect(listener).toHaveBeenCalledTimes(3);
 old.clear();expect(old.getSnapshot()).toBeUndefined();expect(listener).toHaveBeenCalledTimes(4);old.clear();expect(listener).toHaveBeenCalledTimes(4);
});


it('publishes a stopped/discontinuous crop signal even when the actual pose is unchanged',()=>{
 const source=createMapPoseSource('pub/rev'),listener=vi.fn();source.subscribe(listener);
 source.publish([1,1,2],0,60,true);expect(source.getSnapshot()?.continuous).toBe(true);
 source.publish([1,1,2],0,60,false);expect(source.getSnapshot()?.continuous).toBe(false);expect(listener).toHaveBeenCalledTimes(2);
 source.publish([10,1,20],0,60,false);expect(source.getSnapshot()?.point).toEqual([10,20]);
});
