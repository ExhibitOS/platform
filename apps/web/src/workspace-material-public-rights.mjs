// SPDX-License-Identifier: AGPL-3.0-or-later
/** Offline output can enforce the published expiry, but cannot learn a later
 * online withdrawal. Each live public read must additionally recheck source. */
export function publicWorkspaceMaterialRights(value,now=Date.now()){
 if(value===undefined)return true;
 if(!value||typeof value!=='object'||!Array.isArray(value.materials)||!value.materials.length||!Number.isFinite(now))return false;
 return value.materials.every(material=>{const r=material?.rights;if(!r||r.permissions?.display!==true||r.permissions?.export!==true)return false;const start=r.validFrom===undefined?-Infinity:Date.parse(r.validFrom),end=r.expiresAt===undefined?Infinity:Date.parse(r.expiresAt);return !Number.isNaN(start)&&!Number.isNaN(end)&&start<=now&&now<end;});
}
