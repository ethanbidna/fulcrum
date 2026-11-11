import { readFile,readdir,mkdir,writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const bundle=path.resolve('apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle');
function run(command,args){if(spawnSync(command,args,{stdio:'inherit'}).status!==0)throw new Error(`RELEASE_VERIFICATION_FAILED: ${command}`);}
const app=path.join(bundle,'macos/Fulcrum.app');run('codesign',['--verify','--deep','--strict',app]);run('xcrun',['stapler','validate',app]);run('spctl',['--assess','--type','execute',app]);
for(const kind of ['core','mcp']){const file=path.join(app,`Contents/Resources/bin/fulcrum-${kind}`);run('lipo',['-verify_arch','x86_64','arm64',file]);run(file,['--self-test']);}
const dmgs=(await readdir(path.join(bundle,'dmg'))).filter(file=>file.endsWith('.dmg'));if(dmgs.length!==1)throw new Error('ONE_DMG_REQUIRED');run('xcrun',['stapler','validate',path.join(bundle,'dmg',dmgs[0])]);
const config=JSON.parse(await readFile('apps/desktop/src-tauri/tauri.conf.json','utf8'));if(!/^\d+\.\d+\.\d+$/.test(config.version))throw new Error('RELEASE_VERSION_REQUIRED');
const archive='Fulcrum.app.tar.gz';const signature=(await readFile(path.join(bundle,'macos',`${archive}.sig`),'utf8')).trim();if(!signature)throw new Error('UPDATER_SIGNATURE_REQUIRED');
const artifact={signature,url:`https://github.com/ethanbidna/fulcrum/releases/download/v${config.version}/${archive}`};
await mkdir('release-output',{recursive:true});await writeFile('release-output/latest.json',JSON.stringify({version:config.version,notes:'See the reviewed release notes.',pub_date:new Date().toISOString(),platforms:{'darwin-x86_64':artifact,'darwin-aarch64':artifact}},null,2));
