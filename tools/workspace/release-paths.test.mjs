import { test } from 'vitest';
import assert from 'node:assert/strict';
import { releaseLaunch } from '../../apps/core/src/release-paths.ts';
test('packaged clients launch fixed sibling binaries without Node arguments',()=>{
 assert.deepEqual(releaseLaunch('core',{packaged:true,executable:'/Applications/Fulcrum.app/Contents/Resources/bin/fulcrum-mcp'}),{command:'/Applications/Fulcrum.app/Contents/Resources/bin/fulcrum-core',args:[]});
 assert.deepEqual(releaseLaunch('mcp',{packaged:true,executable:'/Applications/Fulcrum.app/Contents/Resources/bin/fulcrum-core'}),{command:'/Applications/Fulcrum.app/Contents/Resources/bin/fulcrum-mcp',args:[]});
});
test('development clients retain the Node/script launch',()=>{
 const result=releaseLaunch('mcp',{packaged:false,executable:'/node'});assert.equal(result.command,'/node');assert.match(result.args[0],/mcp\.mjs$/);
});
