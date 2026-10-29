// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {WalkingJoystick} from './WalkingJoystick';
import {createJoystickGesture,joystickVector} from './walking-joystick';

it('keeps the center quiet and remaps radial distance to proportional speed with screen-up forward',()=>{
 expect(joystickVector(0,0,50)).toEqual({x:0,y:0,right:0,forward:-0});
 expect(joystickVector(6,0,50).right).toBe(0);
 expect(joystickVector(28,0,50).right).toBeCloseTo(.5);
 expect(joystickVector(0,-50,50).forward).toBe(1);
 const diagonal=joystickVector(100,-100,50);
 expect(Math.hypot(diagonal.right,diagonal.forward)).toBeCloseTo(1);
 expect(Math.hypot(diagonal.x,diagonal.y)).toBeCloseTo(50);
 for(const values of [[NaN,0,50],[0,Infinity,50],[1,1,0]])expect(joystickVector(...values as [number,number,number])).toEqual({x:0,y:0,right:0,forward:0});
});
it('owns exactly one pointer and ignores the second finger ending while movement continues',()=>{
 const changed=vi.fn(),actions={move:vi.fn(),release:vi.fn()},other={move:vi.fn(),release:vi.fn()};
 const gesture=createJoystickGesture(changed),rect={left:16,top:100,width:112,height:112};
 expect(gesture.begin(7,72,122,rect,actions)).toBe(true);
 expect(actions.move).toHaveBeenLastCalledWith(7,0,1);
 expect(gesture.begin(8,100,120,rect,other)).toBe(false);
 gesture.move(8,100,120);gesture.end(8);
 expect(actions.release).not.toHaveBeenCalled();expect(gesture.active()).toBe(7);expect(other.move).not.toHaveBeenCalled();
 gesture.move(7,106,156);expect(actions.move).toHaveBeenLastCalledWith(7,1,-0);
 gesture.end(7);expect(actions.release).toHaveBeenCalledExactlyOnceWith(7);expect(changed).toHaveBeenLastCalledWith(0,0);expect(gesture.active()).toBeUndefined();
});
it('returns to zero and releases the original owner once on cancellation, pause, visibility loss or disposal',()=>{
 const changed=vi.fn(),actions={move:vi.fn(),release:vi.fn()},gesture=createJoystickGesture(changed);
 gesture.begin(19,30,30,{left:0,top:0,width:112,height:112},actions);
 gesture.clear();gesture.clear();gesture.end(19);gesture.move(19,0,0);
 expect(actions.release).toHaveBeenCalledExactlyOnceWith(19);expect(changed).toHaveBeenLastCalledWith(0,0);expect(actions.move).toHaveBeenCalledOnce();
 expect(gesture.begin(20,56,56,{left:0,top:0,width:112,height:112},actions)).toBe(true);
 expect(actions.move).toHaveBeenLastCalledWith(20,0,-0);
});
it('does not admit a malformed or undersized control geometry',()=>{
 const actions={move:vi.fn(),release:vi.fn()},gesture=createJoystickGesture(vi.fn());
 for(const width of [0,44,Infinity,NaN])expect(gesture.begin(1,0,0,{left:0,top:0,width,height:112},actions)).toBe(false);
 expect(actions.move).not.toHaveBeenCalled();
});
it('has an accessible name and touch/keyboard help without permanent move/look labels',()=>{
 const markup=renderToStaticMarkup(<WalkingJoystick available paused={false} actions={{move:vi.fn(),release:vi.fn()}}/>);
 expect(markup).toContain('aria-label="이동 조이스틱"');expect(markup).toContain('aria-describedby=');expect(markup).toContain('키보드는 전시 화면에서 W/A/S/D');
 expect(markup).not.toContain('walking-touch-label');expect(markup).not.toContain('disabled=""');
 expect(renderToStaticMarkup(<WalkingJoystick available paused actions={{move:vi.fn(),release:vi.fn()}}/>)).toContain('disabled=""');
 expect(renderToStaticMarkup(<WalkingJoystick available paused resumable actions={{resumeInput:()=>true,move:vi.fn(),release:vi.fn()}}/>)).not.toContain('disabled=""');
 expect(renderToStaticMarkup(<WalkingJoystick available={false} paused={false} actions={null}/>)).toContain('disabled=""');
});
