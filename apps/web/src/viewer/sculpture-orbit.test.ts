// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {createSculptureOrbit,SCULPTURE_ORBIT_STEP,sculptureOrbitPose} from './sculpture-orbit';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
function fixture(bounds={minYaw:-Math.PI,maxYaw:Math.PI}){
 vi.useFakeTimers();const frames=new Map<number,FrameRequestCallback>();let id=0,allowed=true,reduced=false;
 vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{frames.set(++id,fn);return id;});vi.stubGlobal('cancelAnimationFrame',(key:number)=>frames.delete(key));
 const move=vi.fn(()=>true),changed=vi.fn(),orbit=createSculptureOrbit({placementId:'sculpture',bounds,allowed:()=>allowed,reducedMotion:()=>reduced,move,changed});
 return {orbit,move,changed,frames,setAllowed(v:boolean){allowed=v;},setReduced(v:boolean){reduced=v;},frame(){const row=frames.entries().next().value!;frames.delete(row[0]);row[1](performance.now());}};
}
it('rotates only the eye about the authored target with fixed height/radius and rejects invalid coordinates',()=>{
 const eye=[12,1.65,20],target=[10,.8,20],pose=sculptureOrbitPose(eye,target,Math.PI/2)!;
 expect(pose.position).toEqual([10,1.65,18]);expect(pose.target).toEqual(target);expect(eye).toEqual([12,1.65,20]);expect(sculptureOrbitPose(eye,target,NaN)).toBeUndefined();expect(sculptureOrbitPose(target,target,0)).toBeUndefined();
});
it('a tap moves once on matching release, cancellation/stale pointers never activate it',()=>{
 const f=fixture();f.orbit.actions.press(1,7);expect(f.move).not.toHaveBeenCalled();f.orbit.actions.release(8,true);expect(f.move).not.toHaveBeenCalled();f.orbit.actions.release(7,true);expect(f.move).toHaveBeenCalledExactlyOnceWith(SCULPTURE_ORBIT_STEP);
 f.orbit.actions.press(-1,9);f.orbit.actions.release(9,false);expect(f.move).toHaveBeenCalledOnce();
});
it('holds start slowly after the delay and a late frame or release cannot add movement after stop',()=>{
 const f=fixture();f.orbit.actions.press(1,1);vi.advanceTimersByTime(349);expect(f.frames.size).toBe(0);vi.advanceTimersByTime(1);expect(f.orbit.state().holding).toBe(1);
 vi.advanceTimersByTime(50);f.frame();expect(f.move.mock.lastCall![0]).toBeCloseTo(Math.PI/12*.05);
 const stale=[...f.frames.values()][0]!;f.orbit.actions.release(1,true);expect(f.frames.size).toBe(0);const count=f.move.mock.calls.length;stale(performance.now()+50);expect(f.move).toHaveBeenCalledTimes(count);
});
it('a collision refusal keeps the angle and stops a hold; the opposite direction remains explicit',()=>{
 const f=fixture();f.move.mockReturnValue(false);f.orbit.actions.press(1,2);vi.advanceTimersByTime(400);f.frame();expect(f.orbit.state()).toMatchObject({yaw:0,canRight:false,canLeft:true,holding:undefined});expect(f.frames.size).toBe(0);
 f.move.mockReturnValue(true);f.orbit.actions.step(-1);expect(f.orbit.state().yaw).toBeCloseTo(-SCULPTURE_ORBIT_STEP);expect(f.orbit.state().canRight).toBe(true);
});
it('reduced motion retains discrete static steps and never starts a continuous hold',()=>{
 const f=fixture();f.setReduced(true);f.orbit.refresh();f.orbit.actions.press(1,3);vi.advanceTimersByTime(1500);f.orbit.refresh();expect(f.frames.size).toBe(0);expect(f.move).not.toHaveBeenCalled();f.orbit.actions.release(3,true);expect(f.move).toHaveBeenCalledOnce();expect(f.orbit.state()).toMatchObject({available:true,reducedMotion:true,holding:undefined});
});
it('context loss, reduced-motion change and disposal discard held intent without automatic replay',()=>{
 const f=fixture();f.orbit.actions.press(1,4);vi.advanceTimersByTime(350);const stale=[...f.frames.values()][0]!;f.setAllowed(false);f.orbit.refresh();f.setAllowed(true);f.orbit.refresh();stale(performance.now()+50);f.orbit.actions.release(4,true);expect(f.move).not.toHaveBeenCalled();expect(f.frames.size).toBe(0);
 f.orbit.actions.press(1,5);vi.advanceTimersByTime(350);f.setReduced(true);f.orbit.refresh();f.orbit.actions.release(5,true);expect(f.move).not.toHaveBeenCalled();f.orbit.actions.step(1);expect(f.move).toHaveBeenCalledOnce();f.orbit.dispose();f.orbit.actions.step(1);expect(f.move).toHaveBeenCalledOnce();
});
it('limited arcs clamp without wrapping while an explicit full circle crosses its seam by a short step',()=>{
 const f=fixture({minYaw:-.2,maxYaw:.2});f.orbit.actions.step(1);f.orbit.actions.step(1);expect(f.orbit.state()).toMatchObject({yaw:.2,canRight:false});f.orbit.dispose();
 const full=fixture();for(let n=0;n<19;n++)full.orbit.actions.step(1);expect(full.orbit.state().yaw).toBeCloseTo(-Math.PI+SCULPTURE_ORBIT_STEP);expect(full.orbit.state().canRight).toBe(true);
});
