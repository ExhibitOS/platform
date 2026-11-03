// SPDX-License-Identifier: AGPL-3.0-or-later
export interface PublicationTime {
 kind:'instant'|'date'|'unspecified'|'unavailable';
 text:string;
 dateTime?:string;
 timeZone?:string;
 utcOffset?:string;
}
const unavailable=():PublicationTime=>({kind:'unavailable',text:'시간 정보 없음'});
function calendarDate(value:string){
 const date=new Date(value+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
/** Display only: the original instant/offset is retained as machine-readable data.
 * Optional locale/zone arguments are test seams, never a user setting or stored policy.
 */
export function publicationTime(value:unknown,options:{locale?:string;timeZone?:string}={}):PublicationTime {
 if(typeof value!=='string'||value.length>128)return unavailable();
 const raw=value.trim();
 if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return calendarDate(raw)?{kind:'date',text:raw,dateTime:raw}:unavailable();
 const match=/^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?([Zz]|[+-]\d{2}:\d{2})?$/.exec(raw);
 if(!match||!calendarDate(match[1]!)||Number(match[2])>23||Number(match[3])>59||Number(match[4]??0)>59)return unavailable();
 const minute=match[1]+'T'+match[2]+':'+match[3],offset=match[6];
 if(!offset)return {kind:'unspecified',text:minute.replace('T',' ')+' (시간대 정보 없음)',dateTime:raw};
 if(offset.toUpperCase()!=='Z'&&(Number(offset.slice(1,3))>23||Number(offset.slice(4,6))>59))return unavailable();
 const instant=new Date(raw.replace(/[Tt ]/,'T').replace(/z$/,'Z'));
 if(!Number.isFinite(instant.getTime()))return unavailable();
 try{
  const timeZone=options.timeZone??new Intl.DateTimeFormat().resolvedOptions().timeZone;
  if(!timeZone)throw Error('TIME_ZONE_UNAVAILABLE');
  const formatter=new Intl.DateTimeFormat(options.locale,{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const zoneParts=new Intl.DateTimeFormat('en',{timeZone,timeZoneName:'longOffset'}).formatToParts(instant);
  const name=zoneParts.find(part=>part.type==='timeZoneName')?.value;
  if(!name||!/^GMT(?:[+-]\d{2}:\d{2})?$/.test(name))throw Error('TIME_ZONE_OFFSET_UNAVAILABLE');
  const utcOffset=name==='GMT'?'UTC+00:00':name.replace('GMT','UTC');
  return {kind:'instant',text:formatter.format(instant)+` (현지 시간 · ${timeZone} · ${utcOffset})`,dateTime:raw,timeZone,utcOffset};
 }catch{
  // An explicit source offset is honest when browser locale/zone formatting fails.
  return {kind:'instant',text:minute+(offset.toUpperCase()==='Z'?'Z':offset)+' (기록된 시간대 · 현지 시간 변환 불가)',dateTime:raw};
 }
}
