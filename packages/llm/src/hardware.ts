import os from 'node:os';import {statfs,mkdir}from'node:fs/promises';
export async function detectModelHardware(directory:string){
 await mkdir(directory,{recursive:true,mode:0o700});let availableDiskBytes:number|null=null;
 try{const disk=await statfs(directory);availableDiskBytes=disk.bavail*disk.bsize;}catch{/* Unknown disk capacity prevents a managed download. */}
 const architecture=os.arch()==='arm64'?'apple_silicon' as const:os.arch()==='x64'?'intel' as const:'unsupported' as const;
 const runtimeSupported=process.platform==='darwin'&&architecture!=='unsupported'&&Number(os.release().split('.')[0])>=23;
 return {architecture,availableMemoryBytes:os.freemem(),totalMemoryBytes:os.totalmem(),availableDiskBytes,runtimeSupported,runtimeReason:runtimeSupported?null:'Managed Ollama requires macOS 14 or later on Intel or Apple silicon.'};
}
