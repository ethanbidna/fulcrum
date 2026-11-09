import { expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { openWorkspaceHost } from '../../apps/core/src/workspace.ts';
const INITIATIVE = '01000000-0000-7000-8000-000000000901';
const MODEL_PLAN = { actions: [['task','$draft','Draft synthetic brief'],['dependency','$review','Synthetic security approval'],['depends_on','$draft','$review']] };
async function fixture(run, generate = async () => structuredClone(MODEL_PLAN)) {
  const directory = await mkdtemp('/tmp/fplan-'); let host;
  try { host = await openWorkspaceHost({ workspaceDirectory: path.join(directory,'workspace'), localDirectory: path.join(directory,'local'), deviceLabel: 'Synthetic Mac', userEntityId: '08000000-0000-7000-8000-000000000001', create: true, commandRuntime: { generate } });
    await host.execute({ name: 'initiative.create', args: { record: { id: INITIATIVE, title: 'Synthetic launch' } } }); await run(host);
  } finally { await host?.close(); await rm(directory,{recursive:true,force:true}); }
}
async function planned(host, prompt = 'Add task Draft synthetic brief and a security approval before the brief', context = {}) {
  const { id } = await host.planCommand({ prompt, initiativeId: INITIATIVE, ...context });
  await vi.waitFor(() => expect(host.commandPlanStatus(id).phase).not.toBe('running'));
  return host.commandPlanStatus(id);
}
test('local generation previews evidence-backed edits without writes, applies atomically and undoes once', async () => fixture(async host => {
  const before = await host.query('history.list', {}); const status = await planned(host); expect(status.phase).toBe('ready');
  expect(await host.query('history.list',{})).toEqual(before); expect((await host.query('graph.get',{initiativeId:INITIATIVE})).nodes).toHaveLength(0);
  const result = await host.applyCommandPlan(status.plan.id); expect(result.ok).toBe(true); expect(await host.applyCommandPlan(status.plan.id)).toEqual(result);
  const graph = await host.query('graph.get',{initiativeId:INITIATIVE}); expect(graph.nodes).toHaveLength(2); expect(graph.edges).toHaveLength(1);
  const history = await host.query('history.list',{}); expect(history).toHaveLength(before.length+1); expect(history[0].evidenceRefs).toHaveLength(1); expect(history[0].runId).toBe(status.plan.id); expect(history[0].command.name).toBe('command.apply');
  expect(history[0].changes.find(change => change.kind==='source').after).toMatchObject({connector:'manual',excerpt:'Add task Draft synthetic brief and a security approval before the brief'});
  expect((await host.execute({name:'change.undo',args:{eventId:result.eventId}})).ok).toBe(true); expect((await host.query('graph.get',{initiativeId:INITIATIVE})).nodes).toHaveLength(0);
}));
test('stale plans cannot overwrite intervening edits', async () => fixture(async host => {
  const status = await planned(host); expect(status.phase).toBe('ready');
  await host.execute({name:'initiative.update',args:{id:INITIATIVE,patch:{title:'Later synthetic title'}}});
  expect(await host.applyCommandPlan(status.plan.id)).toMatchObject({ok:false,error:{code:'STALE_BASE'}}); expect((await host.query('graph.get',{initiativeId:INITIATIVE})).nodes).toHaveLength(0);
}));
test.each([{actions:[['settings','x','none']]}, {actions:MODEL_PLAN.actions,model:'remote-provider'}, {actions:[['task','$draft','Synthetic task',{protectedFields:[]}]]}])('source-shaped output cannot select authority: %j', async output => fixture(async host => {
    expect((await planned(host)).phase).toBe('failed'); expect((await host.query('graph.get',{initiativeId:INITIATIVE})).nodes).toHaveLength(0);
  }, async () => structuredClone(output)));
test('planning leaves canonical reads available and cancellation aborts the local request', async () => {
  let signal;
  await fixture(async host => {
    const job = await host.planCommand({prompt:'Synthetic request',initiativeId:INITIATIVE}); expect(host.commandPlanStatus(job.id).phase).toBe('running');
    expect(await host.query('initiative.get',{id:INITIATIVE})).toMatchObject({title:'Synthetic launch'});
    host.cancelCommandPlan(job.id); await vi.waitFor(() => expect(host.commandPlanStatus(job.id).phase).toBe('failed')); expect(signal.aborted).toBe(true);
  }, request => new Promise((_resolve,reject) => { signal=request.signal; signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}); }));
});
test('exact named commands resolve immediately without a model and keep one reviewed event', async () => fixture(async host => {
  const id='02000000-0000-7000-8000-000000000905';
  await host.execute({name:'node.create',args:{record:{id,initiativeId:INITIATIVE,type:'task',title:'Draft [review] criteria',state:'open'}}});
  const status=await planned(host,'Rename Draft [review] criteria to "Synthetic review."');expect(status.phase).toBe('ready');
  expect(status.plan.changes).toContainEqual(expect.objectContaining({before:'Draft [review] criteria',after:'Synthetic review.'}));
  expect((await host.applyCommandPlan(status.plan.id)).ok).toBe(true);expect(await host.query('node.get',{id})).toMatchObject({title:'Synthetic review.'});
},async()=>{throw new Error('This exact command must not invoke a model');}));
test('ambiguous named commands ask for a selection without invoking the model', async () => fixture(async host => {
  for(const id of ['02000000-0000-7000-8000-000000000906','02000000-0000-7000-8000-000000000907'])await host.execute({name:'node.create',args:{record:{id,initiativeId:INITIATIVE,type:'task',title:'Synthetic duplicate',state:'open'}}});
  const status=await planned(host,'Rename Synthetic duplicate to Review');expect(status).toMatchObject({phase:'failed',message:expect.stringContaining('More than one')});
},async()=>{throw new Error('Ambiguity must be resolved before generation');}));
test.each(['n1','this'])('parent reference %s creates a canonical child and containment atomically', async parentRef => fixture(async host => {
  const parent='02000000-0000-7000-8000-000000000908';
  await host.execute({name:'node.create',args:{record:{id:parent,initiativeId:INITIATIVE,type:'task',title:'Synthetic parent',state:'open'}}});
  const status=await planned(host,'Add a child task called Prepare launch notes under this task',{target:{kind:'node',id:parent}});expect(status.phase).toBe('ready');expect(status.plan.changes).toHaveLength(2);
  const result=await host.applyCommandPlan(status.plan.id);expect(result.ok).toBe(true);
  const graph=await host.query('graph.get',{initiativeId:INITIATIVE});const child=graph.nodes.find(node=>node.title==='Prepare launch notes');expect(child).toBeTruthy();expect(graph.edges).toContainEqual(expect.objectContaining({type:'contains',fromId:parent,toId:child.id}));expect(graph.nodes.find(node=>node.id===parent).state).toBe('open');
  expect((await host.execute({name:'change.undo',args:{eventId:result.eventId}})).ok).toBe(true);expect((await host.query('graph.get',{initiativeId:INITIATIVE})).nodes).toHaveLength(1);
},async()=>({actions:[['task','$new','Prepare launch notes',parentRef]]})));
test('review shows sequential before values for multiple edits in one command', async () => fixture(async host => {
  const id='02000000-0000-7000-8000-000000000909';
  await host.execute({name:'node.create',args:{record:{id,initiativeId:INITIATIVE,type:'task',title:'Synthetic original',state:'open'}}});
  const status=await planned(host,'Change the title of Synthetic original twice');expect(status.phase).toBe('ready');
  const changes=status.plan.changes.filter(change=>change.field==='title');expect(changes.map(change=>[change.before,change.after])).toEqual([['Synthetic original','Synthetic second'],['Synthetic second','Synthetic final']]);
},async()=>({actions:[['rename','n1','Synthetic second'],['rename','n1','Synthetic final']]})));
test('declared new references resolve even when the model lists relationships first', async () => fixture(async host => {
  const parent='02000000-0000-7000-8000-000000000910';
  await host.execute({name:'node.create',args:{record:{id:parent,initiativeId:INITIATIVE,type:'task',title:'Synthetic parent',state:'open'}}});
  const status=await planned(host,'Add a child task called Prepare launch notes under this task',{target:{kind:'node',id:parent}});
  expect(status.phase).toBe('ready'); expect(status.plan.changes).toHaveLength(2);
  expect((await host.applyCommandPlan(status.plan.id)).ok).toBe(true);
  const graph=await host.query('graph.get',{initiativeId:INITIATIVE});const child=graph.nodes.find(node=>node.title==='Prepare launch notes');
  expect(graph.edges).toContainEqual(expect.objectContaining({type:'contains',fromId:parent,toId:child.id}));
},async()=>({actions:[['contains','n1','n2'],['task','n2','Prepare launch notes']]})));
test.each([{actions:[['contains','n1','n2']]},{actions:[['task','n1','Overwrite existing']]}])('undeclared or colliding references cannot write: %j', async ({actions}) => fixture(async host => {
  const parent='02000000-0000-7000-8000-000000000911';
  await host.execute({name:'node.create',args:{record:{id:parent,initiativeId:INITIATIVE,type:'task',title:'Synthetic parent',state:'open'}}});
  const before=await host.query('history.list',{});
  expect((await planned(host,'Add a child task under this task',{target:{kind:'node',id:parent}})).phase).toBe('failed');
  expect(await host.query('history.list',{})).toEqual(before);
},async()=>({actions})));
