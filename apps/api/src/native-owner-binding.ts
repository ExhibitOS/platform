// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHmac,timingSafeEqual} from 'node:crypto';

const names=['workspaceId','tenantId','principalId','runtimeGeneration','jobId','attemptId','generation','stageId','reservationId','reservationGeneration'] as const;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex=/^[a-f0-9]{64}$/;
export type NativeOwnerBinding=Record<(typeof names)[number],string>&{claimDigest:string;receiptDigest:string};

/** Pure v1 correlation encoding. A digest does not establish Session, claim,
 * authorization, worker exit or a live fence; callers must do so separately. */
export function nativeOwnerBindingDigest(secret:Uint8Array,input:NativeOwnerBinding):string{
 const keys=[...names,'claimDigest','receiptDigest'];
 if(!(secret instanceof Uint8Array)||secret.byteLength!==32||!input||typeof input!=='object'||Array.isArray(input)||Reflect.ownKeys(input).length!==keys.length||Reflect.ownKeys(input).some(key=>typeof key!=='string'||!keys.includes(key)))throw Error('NATIVE_OWNER_BINDING');
 const values=keys.map(name=>Object.getOwnPropertyDescriptor(input,name));
 if(values.some(value=>!value||!('value' in value)||!value.enumerable))throw Error('NATIVE_OWNER_BINDING');
 const ids=values.slice(0,names.length).map(value=>value!.value),claim=values[names.length]!.value,receipt=values[names.length+1]!.value;
 if(ids.some(value=>typeof value!=='string'||!uuid.test(value))||typeof claim!=='string'||!hex.test(claim)||typeof receipt!=='string'||!hex.test(receipt))throw Error('NATIVE_OWNER_BINDING');
 const key=Buffer.from(secret);
 try{return createHmac('sha256',key).update(Buffer.from('ExhibitOS/OEX-import/manager-binding/v1\0','utf8')).update(Buffer.concat(ids.map(id=>Buffer.from(id.replaceAll('-',''),'hex')))).update(Buffer.from(claim,'hex')).update(Buffer.from(receipt,'hex')).digest('hex');}finally{key.fill(0);}
}
export function matchesNativeOwnerBinding(expected:string,actual:string):boolean{
 return typeof expected==='string'&&hex.test(expected)&&typeof actual==='string'&&hex.test(actual)&&timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(actual,'hex'));
}
