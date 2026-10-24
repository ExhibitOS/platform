// SPDX-License-Identifier: AGPL-3.0-or-later
import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {newDraft} from './example';
it('runs complete browser validation when string code generation is disabled',()=>{
 const module=new URL('./exhibition-validation.mjs',import.meta.url).href;
 const program=`import{validateLifecycle}from ${JSON.stringify(module)};let text='';for await(const chunk of process.stdin)text+=chunk;console.log(JSON.stringify(validateLifecycle(JSON.parse(text))));`;
 const result=spawnSync(process.execPath,['--disallow-code-generation-from-strings','--input-type=module','-e',program],{input:JSON.stringify(newDraft()),encoding:'utf8',timeout:15000});
 expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toEqual({valid:true,errors:[]});
});
