import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {assertRoomEnvelopeContents,LIGHT_DETAILS_NAMESPACE} from '@exhibitos/studio-contract';
import {applyGeometryCommand,createGeometryState} from '../geometry/model';
import {onlyPrivateLightValuesChanged} from './light-value-change';
it('permits only nonspatial light values while retaining an existing source envelope issue',async()=>{
 const {exhibition:source}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),before=structuredClone(source),light=source.lights[0]!,{id,...old}=light;
 expect(()=>assertRoomEnvelopeContents(source,source.rooms[0]!.id)).toThrow();
 const changed=applyGeometryCommand(createGeometryState(source),{type:'set-light',id,light:{...old,intensity:151.25}}).present;expect(onlyPrivateLightValuesChanged(source,changed)).toBe(true);expect(()=>assertRoomEnvelopeContents(changed,source.rooms[0]!.id)).toThrow();
 const moved=structuredClone(changed);moved.lights[0]!.transform.position[0]+=.1;expect(onlyPrivateLightValuesChanged(source,moved)).toBe(false);
 const geometry=structuredClone(changed);geometry.rooms[0]!.dimensions.width+=1;expect(onlyPrivateLightValuesChanged(source,geometry)).toBe(false);
 const assets=structuredClone(changed);assets.artworks[0]!.assets[0]!.sha256='0'.repeat(64);expect(onlyPrivateLightValuesChanged(source,assets)).toBe(false);
 const two=structuredClone(changed);two.lights[1]!.intensity+=1;expect(onlyPrivateLightValuesChanged(source,two)).toBe(false);const mixed=structuredClone(changed);mixed.extensions={...mixed.extensions,[LIGHT_DETAILS_NAMESPACE]:{version:1,lights:[{lightId:mixed.lights[1]!.id,fixture:'none',temperatureKelvin:4000}]}};expect(onlyPrivateLightValuesChanged(source,mixed)).toBe(false);expect(source).toEqual(before);
});
