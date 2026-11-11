import { build } from 'esbuild';
import { copyFile,chmod,mkdir,writeFile,cp,rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=path.resolve(process.argv[2]??path.join(root,'apps/desktop/src-tauri/release-resources/bin'));
const FUSE='NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
function run(command,args){const result=spawnSync(command,args,{stdio:'inherit',env:{...process.env,NODE_OPTIONS:''}});if(result.status!==0)throw new Error(`RELEASE_COMMAND_FAILED: ${command}`);}
if(process.platform!=='darwin'||process.versions.node.split('.')[0]!=='22')throw new Error('Build with Node 22 on macOS');
await mkdir(output,{recursive:true});
for(const kind of ['core','mcp']){
 const executable=path.join(output,`fulcrum-${kind}`),main=path.join(output,`${kind}.cjs`),blob=path.join(output,`${kind}.blob`),configuration=path.join(output,`${kind}.json`);
 const result=await build({entryPoints:[path.join(root,`apps/core/src/${kind==='core'?'main':'mcp-main'}.ts`)],outfile:main,bundle:true,alias:{'jsonc-parser':new URL('../../packages/store/node_modules/jsonc-parser/lib/esm/main.js', import.meta.url).pathname},platform:'node',target:'node22',format:'cjs',metafile:true,define:{'import.meta.url':'__fulcrumModuleUrl'},banner:{js:"const __fulcrumModuleUrl = require('node:url').pathToFileURL(require('node:sea').isSea() ? process.execPath : __filename).href;"}});
 if(Object.keys(result.metafile.inputs).some(file=>/dev-bridge|dev-main|node_modules.*[\\/]ws[\\/]/.test(file)))throw new Error('DEVELOPMENT_CODE_IN_RELEASE');
 await writeFile(configuration,JSON.stringify({main,output:blob,disableExperimentalSEAWarning:true,useSnapshot:false,useCodeCache:false}));
 await copyFile(process.execPath,executable);await chmod(executable,0o755);run(process.execPath,['--experimental-sea-config',configuration]);run('/usr/bin/codesign',['--remove-signature',executable]);
 run('pnpm',['exec','postject',executable,'NODE_SEA_BLOB',blob,'--sentinel-fuse',FUSE,'--macho-segment-name','NODE_SEA']);
 run('/usr/bin/codesign',['--force','--sign','-',executable]);
 await Promise.all([main,blob,configuration].map(file=>rm(file)));
}
await cp(path.join(root,'schemas/v1'),path.join(output,'schemas/v1'),{recursive:true});
await cp(path.join(root,'schemas/v2'),path.join(output,'schemas/v2'),{recursive:true});
for(const kind of ['core','mcp'])run(path.join(output,`fulcrum-${kind}`),['--self-test']);
await writeFile(path.join(output,'build-info.json'),JSON.stringify({node:process.versions.node,architecture:process.arch,provisional:true}));
