// SPDX-License-Identifier: AGPL-3.0-or-later
// Drop only unreferenced, side-effect-free JSON constants from generated ESM.
import {Linter} from 'eslint';

function isStaticJson(node) {
  if(node.type==='Literal')return node.regex===undefined&&node.bigint===undefined&&(node.value===null||['string','boolean','number'].includes(typeof node.value));
  if(node.type==='UnaryExpression')return node.operator==='-'&&node.argument.type==='Literal'&&typeof node.argument.value==='number';
  if(node.type==='ArrayExpression')return node.elements.every(element=>element&&isStaticJson(element));
  if(node.type==='ObjectExpression')return node.properties.every(property=>property.type==='Property'&&property.kind==='init'&&!property.computed&&!property.method&&!property.shorthand&&isStaticJson(property.value));
  return false;
}
export function pruneUnusedSchemaData(source) {
  if(typeof source!=='string')throw Error('SCHEMA_DATA_INPUT');
  const edits=[];
  const messages=new Linter().verify(source,[{
    languageOptions:{ecmaVersion:'latest',sourceType:'module'},
    plugins:{schema:{rules:{data:{create(context){
      const code=context.sourceCode;
      return {
        CallExpression(node){if(node.callee.type==='Identifier'&&node.callee.name==='eval')throw Error('SCHEMA_DATA_EVAL');},
        ExpressionStatement(node){if(node.parent.type==='Program'&&node.expression.type==='Literal'&&node.expression.value==='use strict')edits.push(node.range);},
        VariableDeclaration(node){
          if(node.parent.type!=='Program'||node.kind!=='const'||node.declarations.length!==1)return;
          const declaration=node.declarations[0],id=declaration.id;
          if(id.type!=='Identifier'||!/^schema[0-9]+$/.test(id.name))return;
          const variable=code.getScope(node).set.get(id.name);
          if(!variable||variable.references.some(reference=>reference.isRead()))return;
          if(variable.defs.length!==1||variable.references.length!==1||!variable.references[0].isWrite()||!declaration.init||!isStaticJson(declaration.init))throw Error('SCHEMA_DATA_SHAPE');
          edits.push(node.range);
        },
      };
    }}}}},
    rules:{'schema/data':'error'},
  }]);
  if(messages.some(message=>message.fatal))throw Error('SCHEMA_DATA_PARSE');
  for(const [start,end] of edits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,start)+';'+source.slice(end);
  return source;
}
