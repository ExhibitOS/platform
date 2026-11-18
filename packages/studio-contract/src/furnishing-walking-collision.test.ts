import {expect,test} from 'vitest';
import {newDraft} from '../../../apps/web/src/drafts/example';
import {whiteCubeSurfaces} from '../../../apps/web/src/geometry/model';
import {applyArchitecturalFinishCommand,type WallFinish} from './architectural-finishes';
import {applyFurnishingWalkingCollisionOverride,furnishingWalkingCollisionLookup,furnishingWalkingCollisionTargets,reconcileFurnishingWalkingCollision,validateFurnishingWalkingCollision} from './furnishing-walking-collision';

test('only an opted-in plain baseboard becomes a collision target, retaining the default off and explicit override lifecycle',()=>{
 const initial=newDraft().candidate;initial.surfaces=whiteCubeSurfaces(initial.rooms[0]!);
 const wall=initial.surfaces[0]!,other=initial.surfaces[1]!;
 const finish:WallFinish={surfaceId:wall.id,preset:'plain',depth:.12,trimWidth:.02,baseboardHeight:.04,ceilingBand:false};
 const plain=applyArchitecturalFinishCommand(initial,{type:'set-wall-finish',wall:finish});
 const before=applyArchitecturalFinishCommand(plain,{type:'set-wall-finish',wall:{...finish,surfaceId:other.id,plainBaseboard:false}});
 expect(furnishingWalkingCollisionTargets(before).filter(t=>t.kind==='baseboard')).toEqual([]);
 const selected=applyArchitecturalFinishCommand(before,{type:'set-wall-finish',wall:{...finish,plainBaseboard:true}});
 expect(furnishingWalkingCollisionTargets(selected).filter(t=>t.kind==='baseboard')).toEqual([{kind:'baseboard',id:wall.id,defaultEnabled:false}]);
 expect(furnishingWalkingCollisionLookup(selected)('baseboard',wall.id)).toBe(false);
 const enabled=applyFurnishingWalkingCollisionOverride(selected,{kind:'baseboard',id:wall.id},true);
 expect(validateFurnishingWalkingCollision(enabled).valid).toBe(true);
 expect(furnishingWalkingCollisionLookup(enabled)('baseboard',wall.id)).toBe(true);
 const removed=applyArchitecturalFinishCommand(enabled,{type:'set-wall-finish',wall:{...finish,plainBaseboard:false}});
 const reconciled=reconcileFurnishingWalkingCollision(enabled,removed);
 expect(validateFurnishingWalkingCollision(reconciled).valid).toBe(true);
 expect(furnishingWalkingCollisionTargets(reconciled).filter(t=>t.kind==='baseboard')).toEqual([]);
 expect(furnishingWalkingCollisionLookup(reconciled)('baseboard',wall.id)).toBe(false);
});
