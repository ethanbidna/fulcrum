import { cp,mkdir,writeFile,chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const resources=path.resolve('apps/desktop/src-tauri/release-resources');
function run(command,args){if(spawnSync(command,args,{stdio:'inherit'}).status!==0)throw new Error(`RELEASE_COMMAND_FAILED: ${command}`);}
await mkdir(path.join(resources,'bin'),{recursive:true});
for(const kind of ['core','mcp'])run('/usr/bin/lipo',['-create',`release-input/x64/fulcrum-${kind}`,`release-input/arm64/fulcrum-${kind}`,'-output',path.join(resources,'bin',`fulcrum-${kind}`)]);
await cp('schemas/v1',path.join(resources,'bin/schemas/v1'),{recursive:true});
await cp('schemas/v2',path.join(resources,'bin/schemas/v2'),{recursive:true});
await cp('release-input/arm64/THIRD_PARTY_NOTICES.txt',path.join(resources,'THIRD_PARTY_NOTICES.txt'));
const identity=process.env.APPLE_SIGNING_IDENTITY;if(!identity?.startsWith('Developer ID Application:'))throw new Error('DEVELOPER_ID_REQUIRED');
for(const kind of ['core','mcp'])await chmod(path.join(resources,'bin',`fulcrum-${kind}`),0o755);
for(const kind of ['core','mcp'])run('/usr/bin/codesign',['--force','--options','runtime','--timestamp','--entitlements','apps/desktop/src-tauri/entitlements.plist','--sign',identity,path.join(resources,'bin',`fulcrum-${kind}`)]);
const macOS={minimumSystemVersion:'14.0',hardenedRuntime:true,entitlements:'entitlements.plist'};
const provisioning=process.env.APPLE_WORKSPACE_PROVISION_PROFILE;
if(provisioning){
 const team=process.env.APPLE_TEAM_ID;
 if(!/^[A-Z0-9]{10}$/.test(team??''))throw new Error('WORKSPACE_TEAM_REQUIRED');
 const profile=Buffer.from(provisioning,'base64');
 if(!profile.length||profile.length>1024*1024)throw new Error('INVALID_WORKSPACE_PROFILE');
 const account=`${team}.org.fulcrum.desktop`;
 await writeFile(path.join(resources,'workspace.provisionprofile'),profile,{mode:0o600});
 await writeFile(path.join(resources,'workspace-entitlements.plist'),`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.application-identifier</key><string>${account}</string>
<key>com.apple.developer.team-identifier</key><string>${team}</string>
<key>keychain-access-groups</key><array><string>${account}</string></array></dict></plist>`);
 macOS.entitlements='release-resources/workspace-entitlements.plist';
 macOS.files={'embedded.provisionprofile':'release-resources/workspace.provisionprofile'};
}
await writeFile('apps/desktop/src-tauri/tauri.release.json',JSON.stringify({bundle:{targets:['app','dmg'],createUpdaterArtifacts:true,resources:{'release-resources/bin/':'bin/','release-resources/THIRD_PARTY_NOTICES.txt':'THIRD_PARTY_NOTICES.txt'},macOS}},null,2));
