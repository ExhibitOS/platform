// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {publicWorkspaceMaterialRights} from './workspace-material-public-rights.mjs';
it('requires both grants and enforces their time bounds on each check',()=>{
 const material={materials:[{rights:{permissions:{display:true,export:true},validFrom:'2026-01-01T00:00:00Z',expiresAt:'2027-01-01T00:00:00Z'}}]};
 expect(publicWorkspaceMaterialRights(material,Date.parse('2026-06-01T00:00:00Z'))).toBe(true);
 expect(publicWorkspaceMaterialRights(material,Date.parse('2027-01-01T00:00:00Z'))).toBe(false);
 expect(publicWorkspaceMaterialRights({materials:[{rights:{permissions:{display:true,export:false}}}]})).toBe(false);
 expect(publicWorkspaceMaterialRights({materials:[]})).toBe(false);
});
