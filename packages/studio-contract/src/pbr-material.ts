// SPDX-License-Identifier: AGPL-3.0-or-later
/** The existing studio material scalar rules, shared by full and partial assignments. */
export interface PbrMaterial { color:string; roughness:number; metalness:number }
export const DEFAULT_MATERIAL:Readonly<PbrMaterial>=Object.freeze({color:'#f4f1e8',roughness:.8,metalness:0});
export function isPbrMaterial(value:unknown):value is PbrMaterial {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 return Object.keys(v).length===3&&['color','roughness','metalness'].every(k=>Object.hasOwn(v,k))&&typeof v.color==='string'&&/^#[0-9a-f]{6}$/.test(v.color)&&[v.roughness,v.metalness].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1);
}
