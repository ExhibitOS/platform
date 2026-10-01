import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import artworkSchema from '@exhibitos/spec/schemas/artwork.json' with {type:'json'};
// Public schema export, no private validator path or operations dependency.
const Ajv=Ajv2020 as unknown as typeof import('ajv/dist/2020.js').default;
const ajv=new Ajv({strict:true,allErrors:false,coerceTypes:false,removeAdditional:false});
const formats=addFormats as unknown as (a:typeof ajv)=>void;formats(ajv);
const validate=ajv.compile(artworkSchema.$defs.rights);
export function validRights(input:unknown) { return !!validate(input); }
export function allowedRights(input:unknown,permission:'download'|'export',now=Date.now()) {
 if(!Number.isFinite(now)||!validate(input)) return false;
 const rights=input as {permissions:{download:boolean;export:boolean};validFrom?:string;expiresAt?:string};
 const parse=(value:string)=>{
  const time=Date.parse(value);
  const canonical=value.replace(/(?:\.(\d{1,3}))?Z$/,(_all,ms:string|undefined)=>`.${(ms??'').padEnd(3,'0')}Z`);
  return Number.isFinite(time) && new Date(time).toISOString()===canonical ? time : NaN;
 };
 const from=rights.validFrom===undefined ? -Infinity : parse(rights.validFrom);
 const until=rights.expiresAt===undefined ? Infinity : parse(rights.expiresAt);
 return rights.permissions[permission] && !Number.isNaN(from) && !Number.isNaN(until) && from<until && now>=from && now<until;
}
