import { build } from 'esbuild';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));const temporary=await mkdtemp(path.join(tmpdir(),'fulcrum-s3-build-'));
try{const file=path.join(temporary,'native.mjs');await build({entryPoints:[new URL('./native.ts',import.meta.url).pathname],outfile:file,bundle:true,platform:'node',format:'esm',target:'node22'});const result=spawnSync(process.execPath,[file,...process.argv.slice(2)],{env:{...process.env,FULCRUM_SPIKE_ROOT:root},stdio:'inherit'});process.exitCode=result.status??1;}finally{await rm(temporary,{recursive:true,force:true});}
