import { DatabaseSync } from 'node:sqlite';
import { loadStoreValidators, WorkspaceEncryption, generateWorkspaceKey } from '@fulcrum/store';
export async function releaseSelfTest(schemaDirectory:URL){
 const validators=await loadStoreValidators(schemaDirectory);if(!validators)throw new Error('SCHEMAS_UNAVAILABLE');
 const database=new DatabaseSync(':memory:');try{database.exec("CREATE VIRTUAL TABLE probe USING fts5(text); INSERT INTO probe VALUES ('synthetic');");const row=database.prepare("SELECT count(*) AS matches FROM probe WHERE probe MATCH 'synthetic'").get();if(row?.matches!==1)throw new Error('FTS5_UNAVAILABLE');}finally{database.close();}
 const key=await generateWorkspaceKey();
 try {
  const {manifest,session}=await WorkspaceEncryption.create(key);
  try {
   session.verify(manifest,validators);
   const probe='synthetic';
   if(session.decode('event',manifest.workspaceId,session.encode('event',manifest.workspaceId,probe),validators)!==probe)throw new Error('ENCRYPTION_UNAVAILABLE');
  } finally { session.close(); }
 } finally { key.fill(0); }
 process.stdout.write(JSON.stringify({schemas:true,fts5:true,encryption:true})+'\n');
}
