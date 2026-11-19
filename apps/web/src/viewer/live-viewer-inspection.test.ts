// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi} from 'vitest';
import {newDraft} from '../drafts/example';
import type {Vec3} from './navigation';
import {installLiveViewerInspection,qualifyLiveViewerPose} from './live-viewer-inspection';

function fixture() {
  const publication=newDraft().candidate,room=publication.rooms[0]!;
  room.dimensions={width:10,height:4,depth:10};
  room.transform={position:[6,0,-7],rotation:[0,0,0,1],scale:[1,1,1]};
  return {publication,request:{roomId:room.id,eye:[0,1.661,-1] as Vec3,lookAt:[0,.9,8] as Vec3}};
}

test('keeps exact standing eye and permits looking through an opening past the current room',()=>{
  const {publication,request}=fixture();
  const qualify=vi.fn((eye:Vec3)=>eye);
  expect(qualifyLiveViewerPose(publication,request,45,qualify)).toEqual({
    pose:{roomId:request.roomId,eye:[6,1.661,-8],target:[6,.9,1],fov:45},
  });
  expect(qualify).toHaveBeenCalledWith([6,1.661,-8]);
  expect(qualifyLiveViewerPose(publication,{...request,fov:55},45,qualify)).toMatchObject({pose:{fov:55}});
});

test('rejects a nonfinite or outside eye before consulting standing, and refuses blocked or floating eye positions',()=>{
  const {publication,request}=fixture();
  const qualify=vi.fn((eye:Vec3)=>eye);
  expect(qualifyLiveViewerPose(publication,{...request,eye:[Infinity,1.661,0]},45,qualify)).toEqual({reason:'invalid-request'});
  expect(qualifyLiveViewerPose(publication,{...request,eye:[6,1.661,0]},45,qualify)).toEqual({reason:'eye-outside-room'});
  expect(qualify).not.toHaveBeenCalled();
  expect(qualifyLiveViewerPose(publication,request,45,()=>undefined)).toEqual({reason:'standing-unavailable'});
  expect(qualifyLiveViewerPose(publication,request,45,()=>[6,.75,-8])).toEqual({reason:'standing-unavailable'});
});

test('an invalid request preserves the active view and exit restores its ordinary owner once',()=>{
  const {publication,request}=fixture();
  const canvas={} as HTMLCanvasElement&{exhibitosInspectPose?:(value:unknown)=>unknown};
  const restore=vi.fn(),draw=vi.fn(()=>true);
  const dispose=installLiveViewerInspection({
    canvas,publication,currentFov:()=>45,qualifiedStandingEye:eye=>eye,
    enter:()=>restore,draw,read:pose=>({eye:pose.eye}),
  });
  const active=canvas.exhibitosInspectPose?.(request) as {read:()=>unknown;exit:()=>void};
  expect(active).toMatchObject({status:'applied',observation:{eye:[6,1.661,-8]}});
  expect(canvas.exhibitosInspectPose?.({...request,eye:[10,1.661,0]})).toMatchObject({status:'rejected'});
  expect(draw).toHaveBeenCalledTimes(1);
  expect(active.read()).toEqual({eye:[6,1.661,-8]});
  active.exit();expect(active.read()).toBeUndefined();
  dispose();expect(restore).toHaveBeenCalledTimes(1);
  expect(canvas.exhibitosInspectPose).toBeUndefined();
});
