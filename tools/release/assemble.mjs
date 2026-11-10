import { cp,mkdir,writeFile,chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const resources=path.resolve('apps/desktop/src-tauri/release-resources');
function run(command,args){if(spawnSync(command,args,{stdio:'inherit'}).status!==0)throw new Error(`RELEASE_COMMAND_FAILED: ${command}`);}
await mkdir(path.join(resources,'bin'),{recursive:true});
for(const kind of ['core','mcp'])run('/usr/bin/lipo',['-create',`release-input/x64/fulcrum-${kind}`,`release-input/arm64/fulcrum-${kind}`,'-output',path.join(resources,'bin',`fulcrum-${kind}`)]);
await cp('schemas/v1',path.join(resources,'bin/schemas/v1'),{recursive:true});
await cp('release-input/arm64/THIRD_PARTY_NOTICES.txt',path.join(resources,'THIRD_PARTY_NOTICES.txt'));
const identity=process.env.APPLE_SIGNING_IDENTITY;if(!identity?.startsWith('Developer ID Application:'))throw new Error('DEVELOPER_ID_REQUIRED');
for(const kind of ['core','mcp'])await chmod(path.join(resources,'bin',`fulcrum-${kind}`),0o755);
for(const kind of ['core','mcp'])run('/usr/bin/codesign',['--force','--options','runtime','--timestamp','--entitlements','apps/desktop/src-tauri/entitlements.plist','--sign',identity,path.join(resources,'bin',`fulcrum-${kind}`)]);
await writeFile('apps/desktop/src-tauri/tauri.release.json',JSON.stringify({bundle:{targets:['app','dmg'],createUpdaterArtifacts:true,resources:{'release-resources/bin/':'bin/','release-resources/THIRD_PARTY_NOTICES.txt':'THIRD_PARTY_NOTICES.txt'},macOS:{minimumSystemVersion:'14.0',hardenedRuntime:true,entitlements:'entitlements.plist'}}},null,2));
