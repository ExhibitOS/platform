// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {NativeOwnerAuthorityGate} from './native-owner-authority';
const session={tenantId:'tenant',userId:'owner',role:'artist',csrfToken:'csrf',expiresAt:'2099-01-01T00:00:00Z'};
it('invalidates old asynchronous work and issues fresh authority for a same-session reaccept',()=>{const gate=new NativeOwnerAuthorityGate(vi.fn()),first=gate.accept(session)!;expect(gate.accept({...session})).toBe(first);gate.invalidate();expect(first.signal.aborted).toBe(true);const fresh=gate.accept({...session})!;expect(fresh).not.toBe(first);expect(fresh.signal.aborted).toBe(false);});
it('invalidates on changed session and refuses expired deadlines',()=>{const gate=new NativeOwnerAuthorityGate(vi.fn()),first=gate.accept(session)!;const second=gate.accept({...session,csrfToken:'new'})!;expect(first.signal.aborted).toBe(true);expect(second.signal.aborted).toBe(false);expect(gate.accept({...session,expiresAt:'2020-01-01T00:00:00Z'})).toBeUndefined();expect(second.signal.aborted).toBe(true);});
