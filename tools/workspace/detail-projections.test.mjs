import {expect,test} from 'vitest';
import {Domain,projectInitiativeList} from '../../packages/domain/src/index.ts';
import {readJson,loadValidators} from '../reference/schemas.mjs';
const id=(kind,n)=>`${kind}000000-0000-7000-8000-${String(n).padStart(12,'0')}`;
function fixture(){const snapshot=readJson('fixtures/states/portfolio.state.json');const validators=loadValidators();let sequence=0;return new Domain(snapshot,[],{newId:()=>id('09',++sequence+5000),now:()=> '2026-11-09T18:00:00Z',deviceId:snapshot.state.settings.ingestionDeviceId,userEntityId:id('08',2),validateState:value=>validators.workspaceState(value)?[]:validators.workspaceState.errors,validateEvent:value=>validators.changeEvent(value)?[]:validators.changeEvent.errors,commit:async drafts=>drafts.map(draft=>({...draft,seq:++sequence,hlc:`1794247200000-${String(sequence).padStart(4,'0')}`}))});}
test('List is a hierarchy over canonical nodes, with separate prerequisites, role and distinct evidence counts',()=>{
 const state=readJson('fixtures/states/portfolio.state.json').state;const rows=projectInitiativeList(state,id('01',1));const graphNodes=state.nodes.filter(node=>node.initiativeId===id('01',1));
 expect(rows.map(row=>row.node.id).sort()).toEqual(graphNodes.map(node=>node.id).sort());
 const parent=rows.find(row=>row.node.id===id('02',2));const child=rows.find(row=>row.node.id===id('02',3));expect(parent.role).toBe('You');expect(child.depth).toBe(parent.depth+1);expect(child.parentId).toBe(parent.node.id);expect(child.prerequisites.some(item=>item.id===parent.node.id)).toBe(false);
 expect(parent.sourceCount).toBe(new Set(parent.node.evidenceRefs.map(ref=>ref.sourceId)).size);
});
test('initiative History includes child and deleted-node edits, omits other initiatives and is detached',async()=>{
 const domain=fixture();const node=id('02',3);const initiative=id('01',1);
 expect((await domain.execute({name:'node.update',actor:'user',args:{id:node,patch:{title:'Synthetic revised export'}}})).ok).toBe(true);
 await domain.execute({name:'node.update',actor:'user',args:{id:id('02',11),patch:{title:'Other initiative edit'}}});
 await domain.execute({name:'node.delete',actor:'user',args:{id:node}});
 const history=await domain.query('initiative.history',{initiativeId:initiative});expect(history).toHaveLength(2);expect(history.some(entry=>entry.changes.some(change=>change.afterText==='Synthetic revised export'))).toBe(true);
 history[0].changes[0].label='Mutated';expect((await domain.query('initiative.history',{initiativeId:initiative}))[0].changes[0].label).not.toBe('Mutated');
});
test('History links evidence safely, counts whole runs and retains compensating events',async()=>{
 const domain=fixture();const sourceId=id('04',900);const runId=id('09',900);
 await domain.execute({name:'source.record',actor:'connector',args:{record:{id:sourceId,connector:'synthetic',remoteId:'history-test',title:'Synthetic evidence',permalink:'javascript:alert(1)',ingestedAt:'2026-11-09T18:00:00Z',cachePolicy:'none',contentHash:`sha256:${'a'.repeat(64)}`}}});
 const result=await domain.execute({name:'node.update',actor:'user',args:{id:id('02',3),patch:{details:'Synthetic detail'}},runId,evidenceRefs:[{sourceId}]});expect(result.ok).toBe(true);
 await domain.execute({name:'node.update',actor:'user',args:{id:id('02',11),patch:{details:'Other detail'}},runId,evidenceRefs:[{sourceId}]});
 let history=await domain.query('initiative.history',{initiativeId:id('01',1)});expect(history[0]).toMatchObject({runEventCount:2,runInitiativeCount:2,evidence:[{id:sourceId,title:'Synthetic evidence'}]});
 expect((await domain.execute({name:'change.undo',actor:'user',args:{eventId:result.eventId}})).ok).toBe(true);
 history=await domain.query('initiative.history',{initiativeId:id('01',1)});expect(history.find(entry=>entry.eventId===result.eventId).undone).toBe(true);expect(history[0].undoOf).toBe(result.eventId);
});
test('contextual question events show their recorded change rather than an empty history row',async()=>{
 const domain=fixture();const question=structuredClone(readJson('fixtures/states/portfolio.state.json').state.questions[0]);question.id=id('06',901);question.dedupeKey='synthetic-history-question';
 const result=await domain.execute({name:'question.raise',actor:'user',args:{record:question}});expect(result.ok).toBe(true);
 const history=await domain.query('initiative.history',{initiativeId:question.initiativeId});expect(history[0].changes).toHaveLength(1);
});
