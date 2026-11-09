import { CommandIntentCodec, INTENT_SCHEMA } from './command-intents.js';
import type { Invocation } from './command-intents.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Domain, CommandEnvelope, CommandPlan, CommandChange, CommandRequest } from '@fulcrum/domain';
import { MAX_COMMAND_PROMPT_LENGTH } from '@fulcrum/domain';
import type { JsonModelRuntime } from '@fulcrum/llm';
const PROMPT_LIMIT = MAX_COMMAND_PROMPT_LENGTH;
const PLAN_LIMIT = 16;
const PLAN_LIFETIME_MS = 5 * 60_000;
interface SavedPlan { preview: CommandPlan; command: CommandEnvelope; frontier: string; result?: Awaited<ReturnType<Domain['execute']>> }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The local model returned an invalid plan. Try a more specific request.');
  return value as Record<string, unknown>;
}
function materialize(commands: Invocation[]): Invocation[] {
  const ids = new Map<string, string>();
  for (const command of commands) if (command.name.endsWith('.create')) {
    const record = object(command.args.record); if (typeof record.id === 'string') { if (!record.id.startsWith('$') || ids.has(record.id)) throw new Error('New records need distinct symbolic IDs. Please try again.'); ids.set(record.id, randomUUID()); }
    else record.id = randomUUID();
  }
  const resolve = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string' && (key === 'id' || key.endsWith('Id')) && value.startsWith('$')) { const id = ids.get(value); if (!id) throw new Error('The plan refers to an unknown new record. Please try again.'); return id; }
    if (Array.isArray(value)) return value.map(item => resolve(item, key.endsWith('Ids') ? key.slice(0,-1) : key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([field,item]) => [field,resolve(item,field)]));
    return value;
  };
  return resolve(commands) as Invocation[];
}
function parseRequest(input: unknown): CommandRequest {
  const request = object(input);
  if (Object.keys(request).some(key => !['prompt','initiativeId','target'].includes(key)) || typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > PROMPT_LIMIT || request.initiativeId !== undefined && typeof request.initiativeId !== 'string') throw new Error('Enter a request of up to 2,000 characters.');
  if (request.target !== undefined) { const target = object(request.target); if (Object.keys(target).some(key => !['kind','id'].includes(key)) || !['initiative','node','edge'].includes(String(target.kind)) || typeof target.id !== 'string') throw new Error('Select a valid object before planning.'); }
  return request as unknown as CommandRequest;
}
type Snapshot = ReturnType<Domain['getSnapshot']>;
function evidenceCommand(commands: Invocation[], prompt: string, id: string, now: number): CommandEnvelope {
    const sourceId = randomUUID(); const at = new Date(now).toISOString();
    const evidenceRefs = [{ sourceId }];
    for (const command of commands) if (command.name.endsWith('.create') && ['node.create','initiative.create'].includes(command.name)) object(command.args.record).evidenceRefs = evidenceRefs;
    const command: CommandEnvelope = { name: 'command.apply', actor: 'user', runId: id, idempotencyKey: `command-plan:${id}`, evidenceRefs, args: { commands: [{ name: 'source.record', args: { record: { id: sourceId, connector: 'manual', remoteId: id, title: 'Your command', ingestedAt: at, cachePolicy: 'excerpt', excerpt: prompt, contentHash: `sha256:${createHash('sha256').update(prompt).digest('hex')}` } } }, ...commands] } };
    return command;
}
function projectChanges(snapshot: Snapshot, ops: ReturnType<Domain['preview']>['ops']): CommandChange[] {
    const collections = { initiative: snapshot.state.initiatives, node: snapshot.state.nodes, edge: snapshot.state.edges, group: snapshot.state.groups };
    const working = new Map<string,Record<string,unknown>>(Object.values(collections).flat().map(record=>[record.id,structuredClone(record) as unknown as Record<string,unknown>]));
    const records = [...snapshot.state.initiatives,...snapshot.state.nodes,...snapshot.state.groups,...snapshot.state.categories,...snapshot.state.entities,...ops.filter(op => op.op === 'create').map(op => op.record!)];
    const title = (value: unknown) => { const record = (working.get(String(value)) ?? records.find(record => record.id === value)) as unknown as {title?:string;label?:string} | undefined; return record?.title ?? record?.label ?? (value === 'user' ? 'You' : String(value)); };
    const display = (value: unknown, field?: string): string => {
      if (value === null || value === undefined) return 'Not set';
      if (Array.isArray(value)) return value.map(item=>display(item,field)).join(' · ');
      if (field === 'moscow' && typeof value === 'string') return ({must_do:'Must Do',should_do:'Should Do',could_do:'Could Do',wont_do:"Won't Do"} as Record<string,string>)[value] ?? value;
      if (typeof value !== 'object') return ['fromId','toId','groupId','categoryIds','responsibleEntityId','decider'].includes(field??'') ? title(value) : String(value);
      return Object.entries(value).filter(([key]) => !['id','initiativeId','evidenceRefs','protectedFields','createdAt','updatedAt'].includes(key)).map(([key,item]) => `${key==='moscow'?'MoSCoW':key.replace(/Ids?$/,'').replace(/([A-Z])/g,' $1')}: ${display(item,key)}`).join(' · ');
    };
    const changes: CommandChange[] = ops.filter(op => op.kind in collections && !['createdAt','updatedAt','protectedFields'].includes(op.field ?? '')).map(op => {
      const before = working.get(op.id);
      const previous = op.op === 'create' ? null : op.field ? before?.[op.field] : before;
      const next = op.op === 'create' ? op.record : op.op === 'tombstone' ? null : op.value;
      const record = op.record as unknown as {type?:string;title?:string;label?:string;fromId?:string;toId?:string} | undefined;
      const label = op.op === 'create' ? op.kind === 'edge' ? `${title(record?.fromId)} ${String(record?.type).replaceAll('_',' ')} ${title(record?.toId)}` : `Create ${record?.type ?? op.kind}: ${record?.title ?? record?.label ?? ''}` : `${op.op === 'tombstone' ? 'Remove' : `Change ${op.field ?? op.kind} on`} ${title(op.id)}`;
      const change = { kind: op.kind, id: op.id, operation: op.op, ...(op.field ? {field:op.field} : {}), before: previous, after: next, label, beforeText: display(previous,op.field), afterText: display(next,op.field) };
      if(op.op==='create')working.set(op.id,structuredClone(op.record) as Record<string,unknown>);
      else if(op.op==='tombstone')working.delete(op.id);
      else if(before&&op.field)working.set(op.id,{...before,[op.field]:structuredClone(op.value)});
      return change;
    });
    return changes;
}
export class CommandPlanner {
  private controller: AbortController | undefined;
  private readonly plans = new Map<string, SavedPlan>();
  constructor(private readonly domain: () => Domain, private readonly runtime: JsonModelRuntime, private readonly now = Date.now) {}
  async plan(input: unknown, signal?: AbortSignal): Promise<CommandPlan> {
    const request = parseRequest(input);
    const snapshot = this.domain().getSnapshot();
    const codec = new CommandIntentCodec(snapshot,request);
    const frontier = JSON.stringify(snapshot.frontier);
    const output = codec.literal(request.prompt) ?? await this.generate(codec,request,signal);
    const commands = materialize(codec.decode(output));
    const id = randomUUID();
    const command = evidenceCommand(commands,request.prompt,id,this.now());
    if (JSON.stringify(this.domain().getSnapshot().frontier) !== frontier) throw new Error('Your workspace changed while planning. Submit the request again to review a fresh plan.');
    const ops = this.domain().preview(command).ops;
    const changes = projectChanges(snapshot,ops);
    if(!changes.length)throw new Error('That change is already present. Nothing to apply.');
    const preview = { id, prompt: request.prompt, changes, expiresAt: new Date(this.now()+PLAN_LIFETIME_MS).toISOString() };
    while (this.plans.size >= PLAN_LIMIT) this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(id, {preview,command,frontier}); return structuredClone(preview);
  }
  private async generate(codec: CommandIntentCodec, request: CommandRequest, signal?: AbortSignal): Promise<unknown> {
    if (this.controller) throw new Error('Another request is already being planned. Wait or cancel it first.');
    const controller = new AbortController(); this.controller = controller;
    let output: unknown;
    try { output = await this.runtime.generate({ system: codec.instructions, input: JSON.stringify({ context: codec.context, request: request.prompt }), schema: INTENT_SCHEMA, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal }); }
    catch { throw new Error((controller.signal.aborted || signal?.aborted) ? 'Planning cancelled. Your request is kept.' : 'Local AI is unavailable or took too long. Check Ollama, then try again.'); }
    finally { if (this.controller === controller) this.controller = undefined; }
    return output;
  }
  cancel() { this.controller?.abort(); }
  private get(id: string): SavedPlan { const plan = this.plans.get(id); if (!plan) throw new Error('This plan is no longer available. Submit the request again.'); return plan; }
  approved(id: string): CommandEnvelope {
    const plan = this.get(id);
    if (this.now() > Date.parse(plan.preview.expiresAt) || JSON.stringify(this.domain().getSnapshot().frontier) !== plan.frontier) throw new Error('Your workspace changed or this plan expired. Submit the request again before applying.');
    return structuredClone(plan.command);
  }
  result(id: string) { return this.get(id).result; }
  remember(id: string, result: Awaited<ReturnType<Domain['execute']>>) { if (result.ok) this.get(id).result = result; }
}

type JobState = { phase: 'running' } | { phase: 'ready'; plan: CommandPlan } | { phase: 'failed'; message: string };
export class CommandJobs {
  private readonly jobs = new Map<string, { state: JobState; controller: AbortController }>();
  constructor(private readonly planner: CommandPlanner) {}
  start(input: unknown): { id: string } {
    const id = randomUUID(); const controller = new AbortController();
    const job: { state: JobState; controller: AbortController } = { state: { phase: 'running' }, controller };
    while (this.jobs.size >= PLAN_LIMIT) { const oldest = this.jobs.keys().next().value!; this.jobs.get(oldest)!.controller.abort(); this.jobs.delete(oldest); }
    this.jobs.set(id, job);
    void this.planner.plan(input, controller.signal).then(plan => { job.state = { phase: 'ready', plan }; }, error => { job.state = { phase: 'failed', message: error instanceof Error ? error.message : 'Could not plan this request.' }; });
    return { id };
  }
  status(id: string): JobState { const job = this.jobs.get(id); if (!job) throw new Error('Planning request is no longer available.'); return structuredClone(job.state); }
  cancel(id: string) { this.jobs.get(id)?.controller.abort(); }
  close() { for (const job of this.jobs.values()) job.controller.abort(); this.jobs.clear(); }
}
