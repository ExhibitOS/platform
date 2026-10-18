import {describe, expect, it} from "vitest";
import {localLoginContext, localLoginHref} from "./local-login-context";
const tenantId="11111111-1111-4111-8111-111111111111", subject="my-owner";
const query=new URLSearchParams({localTenant:tenantId,localSubject:subject});
describe("selected local installation login hints",()=>{
 it("prefills only nonsecret hints on loopback and preserves them to CMS",()=>{const context=localLoginContext({href:`http://127.0.0.1:13200/studio?${query}`});expect(context).toEqual({tenantId,subject});expect(localLoginHref(context)).toBe(`/cms?${query}`);});
 it("keeps ordinary independent login and refuses malformed or duplicate hints",()=>{for(const href of ["https://example.org/studio?"+query,"http://localhost:13200/studio?"+query,"http://127.0.0.1:13200/cms","http://127.0.0.1:13200/cms?localTenant=invalid&localSubject=owner",`http://127.0.0.1:13200/cms?${query}&localSubject=other`,`http://name:private@127.0.0.1:13200/cms?${query}`,`http://127.0.0.1:13200/cms?localTenant=${tenantId}&localSubject=%3Cscript%3E`])expect(localLoginContext({href})).toBeNull();expect(localLoginHref(null)).toBe("/cms");});
 it("never forwards an arbitrary query or secret as login context",()=>{const context=localLoginContext({href:`http://127.0.0.1:13200/studio?${query}&password=must-not-forward&return=https://other.invalid`});expect(context).toBeNull();expect(localLoginHref(context)).toBe("/cms");});
});
