// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {ReactElement} from 'react';
import {WalkingTouch,type WalkingActions} from './WalkingControls';
type TestProps={children?:unknown;disabled?:boolean;className?:string;onPointerDown:(event:unknown)=>void;onPointerCancel:(event:unknown)=>void;onContextMenu:(event:unknown)=>void};
function buttons(node:unknown):ReactElement<TestProps>[]{
 if(!node||typeof node!=="object")return [];
 const element=node as ReactElement<TestProps>;
 return [...(element.type==='button'?[element]:[]),...[element.props?.children].flat().flatMap(buttons)];
}
it('first resumable touch starts the same movement pointer before later release',()=>{
 const actions={canResumeInput:()=>true,resumeInput:vi.fn(()=>true),press:vi.fn(),release:vi.fn()} as unknown as WalkingActions;
 const control=buttons(WalkingTouch({available:true,paused:true,resumable:true,actions}))[0]!;
 const capture=vi.fn(),event={pointerId:19,pointerType:'touch',button:0,preventDefault:vi.fn(),currentTarget:{setPointerCapture:capture}};
 expect(control.props.disabled).toBe(false);control.props.onPointerDown(event);
 expect(actions.resumeInput).toHaveBeenCalledOnce();expect(capture).toHaveBeenCalledWith(19);expect(actions.press).toHaveBeenCalledWith('forward',19);
 control.props.onPointerCancel(event);expect(actions.release).toHaveBeenCalledWith(19);
});
it('an explicit stop keeps touch disabled and cannot capture or move',()=>{
 const actions={canResumeInput:()=>false,resumeInput:vi.fn(()=>false),press:vi.fn()} as unknown as WalkingActions;
 const control=buttons(WalkingTouch({available:true,paused:true,actions}))[0]!;
 const capture=vi.fn();expect(control.props.disabled).toBe(true);
 control.props.onPointerDown({pointerId:3,pointerType:'touch',preventDefault:vi.fn(),currentTarget:{setPointerCapture:capture}});
 expect(capture).not.toHaveBeenCalled();expect(actions.press).not.toHaveBeenCalled();
});


it('movement and look labels own their touch without starting a world or button action',()=>{
 const actions={resumeInput:vi.fn(()=>true),press:vi.fn(),release:vi.fn()} as unknown as WalkingActions;
 const root=WalkingTouch({available:true,paused:true,resumable:true,actions});
 const descendants=(node:unknown):ReactElement<TestProps>[]=>{
  if(!node||typeof node!=="object")return [];
  const el=node as ReactElement<TestProps>;return [el,...[el.props?.children].flat().flatMap(descendants)];
 };
 const labels=descendants(root).filter(el=>el.props.className==='walking-touch-label');expect(labels).toHaveLength(2);
 for(const label of labels){const event={preventDefault:vi.fn()};label.props.onPointerDown(event);expect(event.preventDefault).toHaveBeenCalledOnce();}
 expect(actions.resumeInput).not.toHaveBeenCalled();expect(actions.press).not.toHaveBeenCalled();
 const menu={preventDefault:vi.fn()};root.props.onContextMenu(menu);expect(menu.preventDefault).toHaveBeenCalledOnce();
});
