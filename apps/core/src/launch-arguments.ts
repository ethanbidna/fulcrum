const VALUE_OPTIONS=new Set(['--workspace','--user-entity','--device-label','--credential-helper']);
export function parseCoreArguments(args:string[]){
 const values=new Map<string,string>();let create=false;
 for(let index=0;index<args.length;index++){
  const key=args[index]!;if(key==='--create'){if(create)throw new Error('DUPLICATE_CONFIGURATION');create=true;continue;}
  if(!VALUE_OPTIONS.has(key)||values.has(key))throw new Error('INVALID_CONFIGURATION');
  const value=args[++index];if(value===undefined||!value)throw new Error('MISSING_CONFIGURATION');values.set(key,value);
 }
 const workspaceDirectory=values.get('--workspace');const userEntityId=values.get('--user-entity');const deviceLabel=values.get('--device-label')??'Local Mac';const credentialHelper=values.get('--credential-helper');
 if(!workspaceDirectory||!userEntityId||!deviceLabel.trim()||deviceLabel.length>80||/[\r\n\0]/.test(deviceLabel))throw new Error('MISSING_CONFIGURATION');
 return{workspaceDirectory,userEntityId,deviceLabel,create,...(credentialHelper?{credentialHelper}:{})};
}
