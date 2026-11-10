import type { AdministrationArgs, AdministrationName, AdministrationResults } from '@fulcrum/domain';
import type { AppliedChange, CommandEnvelope, CommandResult, QueryName, QueryArgs, QueryResults, CommandRequest, CommandPlan } from '@fulcrum/domain';
export interface CoreTransport {
  administer?<N extends AdministrationName>(name: N, args: AdministrationArgs[N]): Promise<AdministrationResults[N]>;
  query<Q extends QueryName>(name: Q, args: QueryArgs[Q]): Promise<QueryResults[Q]>;
  execute(command: Omit<CommandEnvelope, 'actor'>): Promise<CommandResult>;
  planCommand?(request: CommandRequest): Promise<CommandPlan>;
  cancelCommandPlan?(): Promise<void>;
  applyCommandPlan?(id: string): Promise<CommandResult>;
  subscribe(listener: (change: AppliedChange) => void): Promise<() => void>;
  close(): void;
}
export interface RpcChannel {
  request(method: string, params: unknown): Promise<unknown>;
  listen(listener: (message: { method: string; params: AppliedChange }) => void): () => void;
  close(): void;
}
// The shell channel authenticates natively; the webview never receives a Keychain secret.
const PLAN_POLL_INTERVAL_MS = 500;
const PLAN_DEADLINE_MS = 125_000;
export class ShellCoreTransport implements CoreTransport {
  private planningGeneration = 0;
  private planningJob: string | undefined;
  constructor(private readonly channel: RpcChannel) {}
  async query<Q extends QueryName>(name: Q, args: QueryArgs[Q]): Promise<QueryResults[Q]> { return await this.channel.request('query', { name, args }) as QueryResults[Q]; }
  async administer<N extends AdministrationName>(name: N, args: AdministrationArgs[N]): Promise<AdministrationResults[N]> { return await this.channel.request('administration', {name, args}) as AdministrationResults[N]; }
  async execute(command: Omit<CommandEnvelope, 'actor'>): Promise<CommandResult> { return await this.channel.request('execute', command) as CommandResult; }
  async planCommand(request: CommandRequest): Promise<CommandPlan> {
    if (this.planningJob !== undefined) throw new Error('A request is already being planned.');
    const generation = ++this.planningGeneration; this.planningJob = '';
    let id: string;
    try { ({ id } = await this.channel.request('planCommand', request) as { id: string }); }
    catch (error) { if (generation === this.planningGeneration) this.planningJob = undefined; throw error; }
    if (generation !== this.planningGeneration) { await this.channel.request('cancelCommandPlan', { id }); throw new Error('Planning cancelled.'); }
    this.planningJob = id; const deadline = Date.now() + PLAN_DEADLINE_MS;
    try {
      while (this.planningJob === id && Date.now() < deadline) {
        const status = await this.channel.request('commandPlanStatus', { id }) as { phase: string; plan?: CommandPlan; message?: string };
        if (status.phase === 'ready' && status.plan) return status.plan;
        if (status.phase === 'failed') throw new Error(status.message ?? 'Could not plan this request.');
        await new Promise(resolve => setTimeout(resolve, PLAN_POLL_INTERVAL_MS));
      }
      if (this.planningJob === id) await this.channel.request('cancelCommandPlan', { id });
      throw new Error('Planning stopped. Your request is kept; try again.');
    } finally { if (this.planningJob === id) this.planningJob = undefined; }
  }
  async cancelCommandPlan() { this.planningGeneration++; const id = this.planningJob; this.planningJob = undefined; if (id) await this.channel.request('cancelCommandPlan', { id }); }
  async applyCommandPlan(id: string): Promise<CommandResult> { return await this.channel.request('applyCommandPlan', { id }) as CommandResult; }
  async subscribe(listener: (change: AppliedChange) => void): Promise<() => void> {
    const stop = this.channel.listen(message => { if (message.method === 'AppliedChange') listener(message.params); });
    try { await this.channel.request('subscribe', {}); } catch (error) { stop(); throw error; }
    return stop;
  }
  close() { this.channel.close(); }
}
