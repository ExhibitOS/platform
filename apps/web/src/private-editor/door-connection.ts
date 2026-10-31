// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {alignedDoorPair} from '@exhibitos/studio-contract';
import {applyGeometryCommand,createGeometryState,type GeometryCommand} from '../geometry/model';

/** Check this exact straight aperture with the existing capsule, floor and collision engine. */
export async function checkedDoorConnection(document:Exhibition,firstId:string,secondId:string):Promise<GeometryCommand> {
 const pair=alignedDoorPair(document,firstId,secondId),command:GeometryCommand={type:'connect-doors',firstId,secondId};
 const candidate=applyGeometryCommand(createGeometryState(document),command).present;
 const {createNavigationController}=await import('../viewer/navigation');
 const eye=(sign:number):[number,number,number]=>[pair.bottom[0]+sign*pair.firstInterior[0]*.55,pair.bottom[1]+1.6,pair.bottom[2]+sign*pair.firstInterior[2]*.55];
 const first=eye(1),second=eye(-1),controller=await createNavigationController(candidate,{position:first});
 try{const a=controller.qualifiedStandingEye(first),b=controller.qualifiedStandingEye(second);if(!a||!b||!controller.standingSegmentClear(a,b))throw Error('DOOR_PASSAGE_BLOCKED');return command;}finally{controller.dispose();}
}

/** A late physics result must never commit after the calling interaction changes. */
export async function runDoorConnection(document:Exhibition,firstId:string,secondId:string,current:()=>boolean,commit:(command:GeometryCommand)=>void,check=checkedDoorConnection):Promise<boolean>{
 if(!current())return false;const command=await check(document,firstId,secondId);if(!current())return false;commit(command);return true;
}
