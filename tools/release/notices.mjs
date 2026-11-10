import parseSpdx from 'spdx-expression-parse';
import { createHash } from 'node:crypto';
import { readdir,readFile,writeFile,mkdir,realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=path.resolve(process.argv[2]??path.join(root,'apps/desktop/src-tauri/release-resources/THIRD_PARTY_NOTICES.txt'));
const approved=new Set(['MIT','MIT-0','CDLA-Permissive-2.0','Apache-2.0','BSD-2-Clause','BSD-3-Clause','ISC','0BSD','CC0-1.0','Unlicense','Zlib','EPL-2.0','MPL-2.0','Unicode-3.0','Unicode-DFS-2016','BSL-1.0','BlueOak-1.0.0','CC-BY-4.0','CC-BY-3.0','OpenSSL','Artistic-2.0','NCSA']);
export function auditLicense(expression){
 if(typeof expression!=='string'||!expression.trim())throw new Error('LICENSE_MISSING');
 const tree=parseSpdx(expression.replace(/\s*\/\s*/g,' OR '));
 const allowed=node=>node.conjunction==='and'?allowed(node.left)&&allowed(node.right):node.conjunction==='or'?allowed(node.left)||allowed(node.right):approved.has(node.license)&&(!node.exception||node.license==='Apache-2.0'&&node.exception==='LLVM-exception');
 if(!allowed(tree))throw new Error(`LICENSE_REVIEW_REQUIRED: ${expression}`);
}
async function texts(directory){const files=await readdir(directory);const selected=files.filter(name=>/^(licen[sc]e|copying|notice|copyright)([.\-_]|$)/i.test(name));let result='';for(const name of selected.sort()){const file=path.join(directory,name);try{result+=`\n${name}\n${await readFile(file,'utf8')}\n`;}catch{/* Directories do not contain distributable notice text. */}}return result;}
async function generate(){
 const entries=[];const overrideDirectory=path.join(root,'tools/release/licenses');const overrides=JSON.parse(await readFile(path.join(overrideDirectory,'overrides.json'),'utf8'));
 async function nativeText(metadata){const text=await texts(path.dirname(metadata.manifest_path));if(text.trim())return text;const override=overrides[`${metadata.name}@${metadata.version}`];if(!override)throw new Error(`LICENSE_TEXT_MISSING: ${metadata.name}`);const bytes=await readFile(path.join(overrideDirectory,override.file));if(createHash('sha256').update(bytes).digest('hex')!==override.sha256)throw new Error('LICENSE_OVERRIDE_CHANGED');return bytes.toString();}
 const visited=new Set();
 async function visit(directory){
  directory=await realpath(directory);if(visited.has(directory))return;visited.add(directory);
  const metadata=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));
  if(!metadata.private){auditLicense(metadata.license);const text=await texts(directory);if(!text.trim())throw new Error(`LICENSE_TEXT_MISSING: ${metadata.name}`);entries.push({id:`npm ${metadata.name}@${metadata.version}`,license:metadata.license,text:`Source: https://registry.npmjs.org/${metadata.name}/-/${metadata.name.split('/').at(-1)}-${metadata.version}.tgz\n${text}`});}
  for(const name of Object.keys(metadata.dependencies??{})){
   let parent=directory,found;
   while(parent!==path.dirname(parent)){const candidate=path.join(parent,'node_modules',name);try{await readFile(path.join(candidate,'package.json'));found=candidate;break;}catch{parent=path.dirname(parent);}}
   if(!found)throw new Error(`DEPENDENCY_UNAVAILABLE: ${name}`);await visit(found);
  }
 }
 await visit(path.join(root,'apps/core'));await visit(path.join(root,'apps/desktop'));
 const cargo=spawnSync('cargo',['metadata','--format-version','1','--locked','--filter-platform',process.arch==='arm64'?'aarch64-apple-darwin':'x86_64-apple-darwin','--manifest-path',path.join(root,'apps/desktop/src-tauri/Cargo.toml')],{encoding:'utf8',maxBuffer:32*1024*1024});if(cargo.status!==0)throw new Error('CARGO_LICENSE_METADATA_UNAVAILABLE');
 const native=JSON.parse(cargo.stdout);const nativeIds=new Set(native.resolve.nodes.map(node=>node.id));
 for(const metadata of native.packages){if(!metadata.source||!nativeIds.has(metadata.id))continue;auditLicense(metadata.license);const text=await nativeText(metadata);entries.push({id:`cargo ${metadata.name}@${metadata.version}`,license:metadata.license,text:`Source: https://crates.io/api/v1/crates/${metadata.name}/${metadata.version}/download\nAuthors (package metadata): ${(metadata.authors??[]).join(', ')}\n${text}`});}
 const unique=[...new Map(entries.map(entry=>[entry.id,entry])).values()].sort((a,b)=>a.id.localeCompare(b.id));
 const response=await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('NODE_LICENSE_UNAVAILABLE');const nodeLicense=await response.text();if(!nodeLicense.includes('Permission is hereby granted')||!nodeLicense.includes('Node.js'))throw new Error('NODE_LICENSE_INVALID');
 await mkdir(path.dirname(output),{recursive:true});await writeFile(output,await readFile(path.join(root,'LICENSE'),'utf8')+'\nFulcrum third-party notices\nIncludes the JavaScript runtime closure and native Cargo closure; some native entries are build-only.\nModels and Graphiti are not distributed.\n\nNode.js runtime\n'+nodeLicense+unique.map(entry=>`\n${'='.repeat(72)}\n${entry.id}\n${entry.license}\n${entry.text}`).join(''));
 console.log(`Audited ${unique.length} packages and Node.js notices`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await generate();
