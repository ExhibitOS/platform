// SPDX-License-Identifier: AGPL-3.0-or-later
// Preserve AJV context property Gets in order, including getters and proxies.
// Unused property values are discarded only after their observable Get.
import {Linter} from 'eslint';

export function lowerSchemaContext(source){
 if(typeof source!=='string'||source.includes('__schemaContext'))throw Error('SCHEMA_CONTEXT_INPUT');
 const edits=[];
 const messages=new Linter().verify(source,[{languageOptions:{ecmaVersion:'latest',sourceType:'module'},plugins:{schema:{rules:{context:{create(context){
  const code=context.sourceCode;
  return {FunctionDeclaration(node){
   if(!/^validate[0-9]+$/.test(node.id?.name??''))return;
   const [data,param]=node.params;
   if(node.async||node.generator||node.params.length!==2||data.type!=='Identifier'||data.name!=='data'||param.type!=='AssignmentPattern'||param.left.type!=='ObjectPattern'||param.right.type!=='ObjectExpression'||param.right.properties.length!==0||node.body.body.some(s=>s.directive))throw Error('SCHEMA_CONTEXT_SHAPE');
   const properties=param.left.properties,names=properties.map(p=>p.type==='Property'&&!p.computed&&p.kind==='init'&&!p.method&&p.key.type==='Identifier'?p.key.name:'');
   if(names.join(',')!=='instancePath,parentData,parentDataProperty,rootData,dynamicAnchors')throw Error('SCHEMA_CONTEXT_SHAPE');
   const scope=code.getScope(node),lines=[];let unused=false;
   const dataBinding=scope.set.get('data');if(!dataBinding||dataBinding.defs.length!==1||dataBinding.defs[0].type!=='Parameter')throw Error('SCHEMA_CONTEXT_SCOPE');
   for(const p of properties){
    const binding=p.value.type==='AssignmentPattern'?p.value.left:p.value;
    if(binding.type!=='Identifier'||binding.name!==p.key.name)throw Error('SCHEMA_CONTEXT_SHAPE');
    const needsDefault=['instancePath','rootData','dynamicAnchors'].includes(p.key.name);
    if((p.value.type==='AssignmentPattern')!==needsDefault)throw Error('SCHEMA_CONTEXT_DEFAULT');
    if(p.value.type==='AssignmentPattern'){
     const d=p.value.right;
     if(!((p.key.name==='instancePath'&&d.type==='Literal'&&d.value==='')||(p.key.name==='rootData'&&d.type==='Identifier'&&d.name==='data')||(p.key.name==='dynamicAnchors'&&d.type==='ObjectExpression'&&d.properties.length===0)))throw Error('SCHEMA_CONTEXT_DEFAULT');
    }
    const variable=scope.set.get(binding.name);if(!variable||variable.defs.length!==1)throw Error('SCHEMA_CONTEXT_SCOPE');
    if(variable.references.some(ref=>ref.isRead()))lines.push(`let {${source.slice(p.range[0],p.range[1])}}=__schemaContext;`);
    else {
     if(variable.references.some(ref=>ref.init!==true))throw Error('SCHEMA_CONTEXT_WRITE_ONLY');
     // The Get and the original pure default still execute, even if the
     // resulting local was unused. Do not duplicate a getter invocation.
     const value=`__schemaContext.${p.key.name}`;
     lines.push(needsDefault?`void ((value=${source.slice(p.value.right.range[0],p.value.right.range[1])})=>value)(${value});`:`void ${value};`);unused=true;
    }
   }
   if(!unused)return;
   edits.push({start:param.range[0],end:param.range[1],text:'__schemaContext={}'});
   edits.push({start:node.body.range[0]+1,end:node.body.range[0]+1,text:lines.join('')});
  },CallExpression(node){if(node.callee.type==='Identifier'&&node.callee.name==='eval')throw Error('SCHEMA_CONTEXT_EVAL');}};
 }}}}},rules:{'schema/context':'error'}}]);
 if(messages.some(m=>m.fatal))throw Error('SCHEMA_CONTEXT_PARSE');
 for(const e of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,e.start)+e.text+source.slice(e.end);
 return source;
}
