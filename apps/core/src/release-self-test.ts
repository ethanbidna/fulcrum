import { DatabaseSync } from 'node:sqlite';
import { loadStoreValidators } from '@fulcrum/store';
export async function releaseSelfTest(schemaDirectory:URL){
 const validators=await loadStoreValidators(schemaDirectory);if(!validators)throw new Error('SCHEMAS_UNAVAILABLE');
 const database=new DatabaseSync(':memory:');try{database.exec("CREATE VIRTUAL TABLE probe USING fts5(text); INSERT INTO probe VALUES ('synthetic');");const row=database.prepare("SELECT count(*) AS matches FROM probe WHERE probe MATCH 'synthetic'").get();if(row?.matches!==1)throw new Error('FTS5_UNAVAILABLE');}finally{database.close();}
 process.stdout.write(JSON.stringify({schemas:true,fts5:true})+'\n');
}
