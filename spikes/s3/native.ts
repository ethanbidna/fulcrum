import { readFile,mkdtemp,mkdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SqliteContextIndex,snapshotEpisodes } from '../../packages/context/src/index.js';
import type { WorkspaceStateDoc } from '../../packages/schema/src/index.js';
const root=process.env.FULCRUM_SPIKE_ROOT!;
const snapshot:WorkspaceStateDoc=JSON.parse(await readFile(path.join(root,'fixtures/states/portfolio.state.json'),'utf8'));
const identity=JSON.parse(await readFile(path.join(root,'fixtures/scenarios/identity.json'),'utf8'));
snapshot.state.entities.push(...identity.entities);
identity.mentions.push({text:'Northish'},{text:'North',externalId:{connector:'slack',remoteId:'unknown'}});
identity.expected.push({status:'unresolved'},{status:'unresolved'});
const episodes=[];for await(const episode of snapshotEpisodes(snapshot))episodes.push(episode);
const fixture={workspaceId:snapshot.workspaceId,episodes,mentions:identity.mentions,expected:identity.expected};
if(process.argv.includes('--fixture')){process.stdout.write(JSON.stringify(fixture));}
else {
 const temporary=await mkdtemp(path.join(tmpdir(),'fulcrum-s3-native-'));let index:SqliteContextIndex|undefined;
 try{
  const localDirectory=path.join(temporary,'local'),workspaceDirectory=path.join(temporary,'workspace');await mkdir(localDirectory,{mode:0o700});await mkdir(workspaceDirectory);
  const start=performance.now();index=await SqliteContextIndex.open({localDirectory,workspaceDirectory,workspaceId:snapshot.workspaceId});const setupMs=performance.now()-start;
  const ingestStart=performance.now();for(const episode of episodes)await index.ingest(episode);const ingestMs=performance.now()-ingestStart;
  const queryStart=performance.now(),resolutions=await index.resolveEntities(identity.mentions),queryMs=performance.now()-queryStart;
  const rebuildStart=performance.now();await index.rebuild(snapshotEpisodes(snapshot));const rebuildMs=performance.now()-rebuildStart;
  process.stdout.write(JSON.stringify({schemaVersion:1,implementation:'native-sqlite',fixtureSha256:createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),episodeCount:episodes.length,setupMs,ingestMs,queryMs,rebuildMs,episodesPerMinute:episodes.length*60000/ingestMs,llmRequests:0,embeddingRequests:0,processPeakRssBytes:process.resourceUsage().maxRSS*1024,resolutions:resolutions.map(result=>result.status==='resolved'?{status:result.status,entityId:result.entityId}:result.status==='ambiguous'?{status:result.status,candidateIds:result.candidateIds}:{status:result.status})}));
 }finally{await index?.close();await rm(temporary,{recursive:true,force:true});}
}
