// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {publicWorkspaceFurnishingRights} from './public-rights.mjs';
it('requires current display and export rights for every public furnishing',()=>{
 const now=Date.parse('2030-01-01T00:00:00Z'),item={rights:{permissions:{display:true,export:true},expiresAt:'2030-01-01T00:00:01Z'}};
 expect(publicWorkspaceFurnishingRights(undefined,now)).toBe(true);
 expect(publicWorkspaceFurnishingRights({furnishings:[item]},now)).toBe(true);
 expect(publicWorkspaceFurnishingRights({furnishings:[item]},now+1000)).toBe(false);
 expect(publicWorkspaceFurnishingRights({furnishings:[item,{rights:{permissions:{display:true,export:false}}}]},now)).toBe(false);
 expect(publicWorkspaceFurnishingRights({furnishings:[{...item,rights:{...item.rights,validFrom:'invalid'}}]},now)).toBe(false);
});
