// SPDX-License-Identifier: AGPL-3.0-or-later
// Normalize repeated AJV var declarations without changing their hoisted
// binding or initializer order. Unknown declaration shapes fail closed.
import {Linter} from 'eslint';

export function normalizeSchemaHoists(source) {
  if (typeof source !== 'string') throw Error('SCHEMA_HOIST_INPUT');
  const edits=[];
  const parser=new Linter();
  const messages=parser.verify(source,[{
    languageOptions:{ecmaVersion:'latest',sourceType:'module'},
    plugins:{schema:{rules:{hoists:{create(context){
      const code=context.sourceCode;
      return {VariableDeclaration(node){
        if(node.kind!=='var'||node.declarations[0]?.id?.name!=='_valid0')return;
        let scope=code.getScope(node),variable;
        while(scope&&!variable){variable=scope.set.get('_valid0');scope=scope.upper;}
        if(!variable||variable.defs.length<2)return;
        if(variable.scope.type!=='function'||node.parent.type!=='BlockStatement'||node.declarations.length!==1||!node.declarations[0].init||source.slice(node.range[0],node.declarations[0].id.range[0])!=='var ')throw Error('SCHEMA_HOIST_SHAPE');
        const definitions=variable.defs.map(def=>def.parent);
        if(definitions.some(def=>def?.type!=='VariableDeclaration'||def.kind!=='var'||def.declarations.length!==1||!def.declarations[0].init||def.parent.type!=='BlockStatement'))throw Error('SCHEMA_HOIST_SHAPE');
        if(node.range[0]!==Math.min(...definitions.map(def=>def.range[0])))edits.push(node.range[0]);
      }};
    }}}}},
    rules:{'schema/hoists':'error'},
  }]);
  if(messages.some(message=>message.fatal))throw Error('SCHEMA_HOIST_PARSE');
  for(const position of edits.sort((a,b)=>b-a))source=source.slice(0,position)+source.slice(position+4);
  return source;
}
