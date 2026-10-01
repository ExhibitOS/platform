import { it,expect } from 'vitest';
import { allowedRights } from './rights.ts';
const rights={holder:'Synthetic contributor',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:false,download:true,export:true,commercial:false}};
it('validFrom inclusive, expiry exclusive and calendar/finite times reject',()=>{
 const now=Date.parse('2026-10-01T00:00:00Z');
 expect(allowedRights({...rights,validFrom:'2026-10-01T00:00:00Z'},'export',now)).toBe(true);
 expect(allowedRights({...rights,expiresAt:'2026-10-01T00:00:00Z'},'export',now)).toBe(false);
 for(const expiresAt of ['2016-12-31T23:59:60Z','2027-02-30T00:00:00Z','2027-01-01T00:00:00.1234Z']) expect(allowedRights({...rights,expiresAt},'export',now)).toBe(false);
 expect(allowedRights(rights,'export',NaN)).toBe(false);
 expect(allowedRights({...rights,validFrom:'2027-01-01T00:00:00Z',expiresAt:'2026-01-01T00:00:00Z'},'export',now)).toBe(false);
});
it('full public OES rights required; display/download/export independent',()=>{
 expect(allowedRights({export:true},'export')).toBe(false);
 expect(allowedRights({...rights,export:true},'export')).toBe(false);
 expect(allowedRights({...rights,permissions:{...rights.permissions,download:false}},'download')).toBe(false);
 expect(allowedRights({...rights,permissions:{...rights.permissions,download:false}},'export')).toBe(true);
 expect(allowedRights({...rights,permissions:{...rights.permissions,export:false}},'download')).toBe(true);
});
