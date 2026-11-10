import { invariantMessage } from './invariant-messages.js';
import type { ChangeEvent, CommandInvocation, Question, Op, RecordKind, Target, WorkspaceStateDoc } from '@fulcrum/schema';
import { checkAffectedInvariants } from './affected.js';
import { checkInvariants } from './invariants.js';
import { checkPolicy, PolicyRule } from './policy.js';
import type { PolicyIntent } from './policy.js';
import { clone, DomainFault, object, recordKey, suggestionSignature, text, validateInvocation, writerKey } from './commands.js';
import type { AppliedChange, CommandEnvelope, CommandResult, DomainPorts, EventDraft } from './commands.js';
import { handleCommand, parseTarget, recordRejection } from './handlers.js';
import { replayEvents } from './replay.js';
import type { Replay } from './replay.js';
import { Transaction } from './transaction.js';
import type { WorkspaceState } from './types.js';
import { syncQuestions } from './sync-questions.js';
import { obsoleteQuestions, executableChoices } from './questions.js';
import type { QuestionIdentity } from './questions.js';
import { queryProjection, validateQuery } from './queries.js';
import type { QueryName, QueryArgs, QueryResults } from './queries.js';

const SCHEMA_VERSION = 1;
const MAX_RESOLUTION_COMMANDS = 64;
const PREVIEW_SEQUENCE = 1;
const PREVIEW_HLC = '9999999999999-0000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTORS = ['user', 'ai', 'connector', 'mcp', 'system'];
export class Domain {
  private replay: Replay;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(change: AppliedChange) => void>();
  private readOnly: boolean;
  constructor(private readonly snapshot: WorkspaceStateDoc, events: ChangeEvent[], private readonly ports: DomainPorts) {
    this.snapshot = clone(snapshot);
    this.readOnly = ports.readOnly === true || snapshot.v !== SCHEMA_VERSION;
    for (const event of events) this.validateErrors(ports.validateEvent(event));
    this.replay = replayEvents(snapshot, events);
    this.validateErrors(ports.validateState(this.replay.document));
    const violations = checkInvariants(this.state);
    if (violations.length) throw new DomainFault('INVARIANT_VIOLATION', 'Invalid initial graph', { invariant: violations[0]!.code, violations });
  }
  private get state() { return this.replay.document.state as WorkspaceState; }
  async query<Q extends QueryName>(name: Q, args: QueryArgs[Q]): Promise<QueryResults[Q]> {
    validateQuery(name, args);
    if (name === 'search' || name === 'status.index') {
      const index = this.ports.readIndex;
      if (!index) throw new DomainFault('INDEX_UNAVAILABLE', 'Search index is unavailable');
      try {
        const input = args as QueryArgs['search'];
        const result = name === 'search' ? await index.search(input.text, input.scope) : index.status();
        return clone(result) as QueryResults[Q];
      } catch (error) {
        const invalid = error instanceof Error && 'code' in error && error.code === 'VALIDATION_FAILED';
        throw new DomainFault(invalid ? 'VALIDATION_FAILED' : 'INDEX_UNAVAILABLE', invalid ? 'Invalid search input' : 'Search index is unavailable');
      }
    }
    return queryProjection(this.replay, name, args, () => this.ports.now());
  }
  getSnapshot(): WorkspaceStateDoc { return clone(this.replay.document); }
  questionMaintenance(identify: QuestionIdentity): CommandEnvelope[] {
    const questions = syncQuestions(this.replay, identify).filter(command => this.canPrepareQuestion(command.args.record as unknown as Question));
    const obsolete: CommandEnvelope[] = this.state.questions.flatMap(question => {
      if (questions.some(command => object(command.args.record).id === question.id)) return [];
      if (question.reason !== 'sync_conflict' || !['open', 'deferred'].includes(question.state)) return [];
      const choice = question.resolutions.flatMap(choice => choice.commands).find(command => command.name === 'sync.chooseValue');
      if (!choice) return [];
      const target = object(choice.args.target);
      if (this.replay.writers.get(`${String(target.kind)}:${String(target.id)}:${String(choice.args.field)}`) === choice.args.baseEventId) return [];
      return [{ name: 'question.markObsolete', args: { id: question.id }, actor: 'system' }];
    });
    const due: CommandEnvelope[] = this.state.questions.filter(question => question.state === 'deferred' && question.deferredUntil && Date.parse(question.deferredUntil) <= Date.parse(this.ports.now()) && !obsolete.some(command => command.args.id === question.id) && this.canPrepareQuestion(question))
      .map(question => ({ name: 'question.raise', args: { record: clone(question) }, actor: 'system' }));
    return [...due, ...questions, ...obsolete, ...obsoleteQuestions(this.replay.document)];
  }
  history(): ChangeEvent[] { return clone(this.replay.events); }
  subscribe(listener: (change: AppliedChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  execute(command: CommandEnvelope): Promise<CommandResult> {
    const submitted = clone(command);
    const operation = this.tail.then(() => this.executeSerial(submitted));
    this.tail = operation.catch(() => undefined);
    return operation;
  }
  private async executeSerial(command: CommandEnvelope): Promise<CommandResult> {
    try {
      this.validateEnvelope(command);
      if (this.readOnly) throw new DomainFault('WORKSPACE_READ_ONLY', 'Workspace is read-only');
      const previous = command.idempotencyKey && this.replay.events.find(event => event.idempotencyKey === command.idempotencyKey);
      if (previous) {
        if (previous.actor !== command.actor) throw new DomainFault('POLICY_DENIED', 'Idempotency key belongs to another actor', { rule: PolicyRule.McpScope });
        if (command.actor === 'mcp') for (const event of this.replay.events.filter(event => event.idempotencyKey === command.idempotencyKey)) {
          this.authorize(event.command, command, this.state, this.state, event.ops, []);
        }
        return this.originalResult(previous);
      }
      this.checkBases(command);
      const drafts = command.name === 'change.undo' || command.name === 'run.undo' ? this.prepareUndo(command) : [this.prepareRestoreResolution(command) ?? this.prepare(command)];
      return await this.commit(drafts);
    } catch (error) {
      if (error instanceof DomainFault) return { ok: false, error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } };
      throw error;
    }
  }
  preview(command: CommandEnvelope): { ops: Op[] } {
    this.validateEnvelope(command); this.checkBases(command);
    if (['change.undo', 'run.undo'].includes(command.name)) throw new DomainFault('VALIDATION_FAILED', 'Undo cannot be previewed as a plan');
    return { ops: clone(this.prepare(command).ops) };
  }
  private validateEnvelope(command: CommandEnvelope) {
    validateInvocation(command);
    const allowed = ['name', 'args', 'actor', 'idempotencyKey', 'evidenceRefs', 'runId', 'reason', 'baseEventIds'];
    if (Object.keys(command).some(key => !allowed.includes(key)) || !ACTORS.includes(command.actor)) throw new DomainFault('VALIDATION_FAILED', 'Invalid command envelope');
    for (const key of ['idempotencyKey', 'runId', 'reason'] as const) if (command[key] !== undefined) text(command[key]);
    if (command.evidenceRefs !== undefined && !Array.isArray(command.evidenceRefs)) throw new DomainFault('VALIDATION_FAILED', 'Invalid evidence references');
    if (command.baseEventIds !== undefined) for (const value of Object.values(object(command.baseEventIds))) {
      if (value !== null && (typeof value !== 'string' || !UUID.test(value))) throw new DomainFault('VALIDATION_FAILED', 'Invalid base event');
    }
  }
  private checkBases(command: CommandEnvelope) {
    for (const [key, expected] of Object.entries(command.baseEventIds ?? {})) {
      const actual = this.replay.writers.get(key) ?? null;
      if (actual !== expected) throw new DomainFault('STALE_BASE', 'Field changed since it was read', { field: key, expected, actual });
    }
  }
  private canPrepareQuestion(question: Question): boolean {
    try { this.validateQuestionChoices(question, 'system'); return true; }
    catch (error) { if (error instanceof DomainFault) return false; throw error; }
  }
  private validateQuestionChoices(question: Question, actor: CommandEnvelope['actor']) {
    if (!executableChoices(question.resolutions)) throw new DomainFault('VALIDATION_FAILED', 'Question requires two or three executable choices');
    for (const choice of question.resolutions) {
      if (!choice.commands.length) continue;
      const authority = actor === 'mcp' ? 'mcp' : 'user';
      const undo = choice.commands[0];
      if (undo?.name === 'change.undo') {
        const original = this.replay.events.find(event => event.eventId === undo.args.eventId);
        if (question.reason !== 'sync_conflict' || !original?.ops.some(op => op.op === 'tombstone')) throw new DomainFault('VALIDATION_FAILED', 'Restore choice requires a deleted record');
        this.prepareUndo({ ...validateInvocation(undo), actor: authority });
        continue;
      }
      this.prepare({ name: 'command.apply', args: { commands: choice.commands }, actor: authority });
    }
  }
  private prepareRestoreResolution(command: CommandEnvelope): EventDraft | undefined {
    if (command.name !== 'question.resolve') return;
    const question = this.state.questions.find(question => question.id === command.args.id);
    const resolution = question?.resolutions.find(resolution => resolution.id === command.args.resolutionId);
    if (resolution?.commands.length !== 1 || resolution.commands[0]?.name !== 'change.undo') return;
    if (!question || !['open', 'deferred'].includes(question.state)) throw new DomainFault('VALIDATION_FAILED', 'Question is already closed');
    const invocation = validateInvocation(resolution.commands[0]);
    const original = this.replay.events.find(event => event.eventId === invocation.args.eventId);
    if (question.reason !== 'sync_conflict' || !original?.ops.some(op => op.op === 'tombstone')) throw new DomainFault('VALIDATION_FAILED', 'Restore choice requires a deleted record');
    const undo: CommandEnvelope = { ...command, name: 'change.undo', args: invocation.args };
    const draft = this.prepareUndo(undo)[0]!;
    const restored = replayEvents(this.replay.document, [{ ...draft, seq: PREVIEW_SEQUENCE, hlc: PREVIEW_HLC }]);
    const tx = new Transaction(clone(restored.document.state) as WorkspaceState, new Map(restored.writers), draft.eventId);
    tx.set('question', question.id, 'state', 'resolved');
    tx.set('question', question.id, 'resolvedWith', resolution.id);
    this.authorize(command, command, this.state, tx.state, tx.ops, tx.requested);
    this.validateTransaction(this.state, tx);
    return { ...draft, command: { name: command.name, args: clone(command.args) }, ops: [...draft.ops, ...tx.ops] };
  }
  private prepare(command: CommandEnvelope): EventDraft {
    const id = this.ports.newId(); const now = this.ports.now();
    const tx = new Transaction(clone(this.state), new Map(this.replay.writers), id);
    let commandCount = 0;
    const active = new Set<string>();
    const apply = (value: CommandInvocation) => {
      if (++commandCount > MAX_RESOLUTION_COMMANDS) throw new DomainFault('VALIDATION_FAILED', 'Question resolution command limit exceeded');
      const invocation = validateInvocation(value);
      if (command.actor === 'ai' && /^(settings|device|source|suggestion|field)\./.test(invocation.name)) {
        throw new DomainFault('POLICY_DENIED', 'This command requires user authority or the connector driver', { rule: PolicyRule.IngestionDevice });
      }
      if (invocation.name === 'question.resolve' && !['user', 'mcp'].includes(command.actor)) throw new DomainFault('POLICY_DENIED', 'Only the user can choose a question resolution', { rule: PolicyRule.ManualPrecedence });
      if (['change.undo', 'run.undo'].includes(invocation.name)) throw new DomainFault('VALIDATION_FAILED', 'Undo cannot be embedded in a resolution');
      if (invocation.name === 'command.apply') {
        if (commandCount !== 1 || !['user', 'mcp'].includes(command.actor) || !Array.isArray(invocation.args.commands) || !invocation.args.commands.length || invocation.args.commands.length >= MAX_RESOLUTION_COMMANDS) throw new DomainFault('VALIDATION_FAILED', 'Invalid approved command plan');
        for (const child of invocation.args.commands) apply(child as CommandInvocation);
        return;
      }
      const key = JSON.stringify(invocation);
      if (active.has(key)) throw new DomainFault('VALIDATION_FAILED', 'Recursive question resolution');
      active.add(key);
      const before = clone(tx.state); const start = tx.ops.length; const writeStart = tx.requested.length;
      const proof = command.actor === 'ai' ? this.ports.reconciliationProof?.(invocation) : undefined;
      if (proof?.commitmentAssertion) tx.create('assertion', proof.commitmentAssertion);
      if (invocation.name === 'question.raise') this.validateQuestionChoices(object(invocation.args.record) as unknown as Question, command.actor);
      handleCommand(tx, invocation, { actor: command.actor, now, apply });
      this.validateErrors(this.ports.validateState({ ...this.replay.document, state: tx.state }));
      const ops = tx.ops.slice(start);
      const requested = tx.requested.slice(writeStart);
      this.authorize(invocation, command, before, tx.state, ops, requested, proof);
      this.addManualProtection(tx, command, requested);
      active.delete(key);
    };
    try { apply(command); }
    catch (error) {
      if (command.actor === 'ai' && error instanceof DomainFault && error.code === 'PROTECTED_FIELD') return this.prepareSuggestions(command, tx, now);
      throw error;
    }
    this.addTimestamps(tx, now);
    this.validateTransaction(this.state, tx);
    return this.draft(command, tx, now);
  }
  private authorize(invocation: CommandInvocation, envelope: CommandEnvelope, before: WorkspaceState, after: WorkspaceState, ops: Op[], requested: Transaction['requested'], proof?: ReturnType<NonNullable<DomainPorts['reconciliationProof']>>) {
    if (envelope.actor === 'ai') for (const op of ops.filter(op => op.op === 'tombstone')) {
      const record = new Transaction(before, new Map(), '').get(op.kind, op.id);
      const protectedFields = record.protectedFields as string[] | undefined;
      if (protectedFields?.length || [...this.replay.protections].some(key => key.startsWith(`${recordKey(op.kind, op.id)}:`))) {
        throw new DomainFault('PROTECTED_FIELD', 'AI cannot delete a protected record', { rule: PolicyRule.ProtectedFields });
      }
    }
    const scopedState = clone(before);
    if (proof?.commitmentAssertion) scopedState.assertions.push(proof.commitmentAssertion);
    const creation = ops.find(op => op.op === 'create' && ['initiative', 'node', 'edge', 'entity'].includes(op.kind));
    const intent: PolicyIntent = {
      name: invocation.name, actor: envelope.actor,
      writes: requested.filter(write => ['initiative', 'node', 'edge'].includes(write.kind)).map(write => ({ target: { kind: write.kind as Target['kind'], id: write.id }, field: write.field })),
      initiativeIds: affectedInitiatives(ops, before, after, invocation),
      suggestionSignature: suggestionSignature(invocation),
      ...(envelope.evidenceRefs ? { evidenceRefs: envelope.evidenceRefs } : {}),
      ...(creation ? { creation: { kind: creation.kind as 'initiative' | 'node' | 'edge' | 'entity', id: creation.id, ...(creation.kind === 'node' ? { nodeType: String(creation.record?.type) } : {}) } } : {}),
      ...(proof?.commitmentAssertion ? { commitmentAssertionId: proof.commitmentAssertion.id } : {}),
      ...(invocation.name === 'initiative.setLifecycle' ? { lifecycle: String(invocation.args.lifecycle) } : {}),
      ...(invocation.name === 'question.raise' ? { question: object(invocation.args.record) as unknown as NonNullable<PolicyIntent['question']> } : {}),
    };
    // New records are available for scope checks, without replacing pre-write protection.
    for (const op of ops) if (op.op === 'create' && ['initiative', 'node', 'edge'].includes(op.kind)) {
      const collection = op.kind === 'initiative' ? scopedState.initiatives : op.kind === 'node' ? scopedState.nodes : scopedState.edges;
      (collection as unknown[]).push(op.record);
    }
    this.checkGlobalMcpScope(invocation.name, envelope.actor);
    const result = checkPolicy(intent, { state: scopedState, deviceId: this.ports.deviceId, userEntityId: this.ports.userEntityId, ...(this.ports.mcp ? { mcp: this.ports.mcp } : {}), ...(proof?.match ? { match: proof.match } : {}) });
    if (result.ok && envelope.actor === 'ai' && requested.some(write => this.replay.protections.has(writerKey(write.kind, write.id, write.field)))) {
      throw new DomainFault('PROTECTED_FIELD', 'AI cannot overwrite a manual correction', { rule: PolicyRule.ProtectedFields });
    }
    if (!result.ok) throw new DomainFault(result.rule === PolicyRule.ProtectedFields ? 'PROTECTED_FIELD' : 'POLICY_DENIED', 'Command denied by autonomy policy', { rule: result.rule, disposition: result.disposition });
  }
  private prepareSuggestions(command: CommandEnvelope, attempted: Transaction, now: string): EventDraft {
    const gate = checkPolicy({ name: command.name, actor: command.actor, writes: [], initiativeIds: [], suggestionSignature: suggestionSignature(command), ...(command.evidenceRefs ? { evidenceRefs: command.evidenceRefs } : {}) }, { state: this.state, deviceId: this.ports.deviceId, userEntityId: this.ports.userEntityId });
    if (!gate.ok) throw new DomainFault('POLICY_DENIED', 'Suggestion denied by autonomy policy', { rule: gate.rule });
    const tx = new Transaction(clone(this.state), new Map(this.replay.writers), attempted.eventId);
    const unique = new Map(attempted.requested.map(write => [writerKey(write.kind, write.id, write.field), write]));
    for (const write of unique.values()) {
      if (!['initiative', 'node', 'edge'].includes(write.kind) || ['protectedFields', 'updatedAt', 'createdAt'].includes(write.field)) continue;
      const target = { kind: write.kind as Target['kind'], id: write.id, field: write.field };
      const record = tx.get(write.kind, write.id);
      const protectedFields = record.protectedFields as string[] | undefined;
      if (!protectedFields?.includes(write.field) && !this.replay.protections.has(writerKey(write.kind, write.id, write.field))) continue;
      tx.create('assertion', { id: this.ports.newId(), target, predicate: write.field, value: attempted.get(write.kind, write.id)[write.field] ?? null, evidenceRefs: command.evidenceRefs, observedAt: now, certainty: 'inferred', status: 'suggested' });
      if (!['moscow', 'title', 'lifecycle', 'state', 'outcome', 'condition', 'fromId', 'toId', 'type'].includes(write.field)) continue;
      const dedupeKey = `protected:${write.kind}:${write.id}:${write.field}`;
      const existing = tx.state.questions.find(question => question.dedupeKey === dedupeKey && ['open', 'deferred'].includes(question.state));
      const initiativeId = write.kind === 'initiative' ? write.id : text(record.initiativeId);
      handleCommand(tx, { name: 'question.raise', args: { record: { id: existing?.id ?? this.ports.questionId?.(dedupeKey) ?? this.ports.newId(), initiativeId, target, prompt: 'Keep your value or apply the source-backed suggestion?', reason: 'protected_field_challenge', evidenceRefs: command.evidenceRefs, materiality: 'medium', dedupeKey, resolutions: [{ id: 'keep', label: 'Keep my value', commands: [] }, { id: 'apply', label: 'Apply the suggestion', commands: [{ name: command.name, args: command.args }] }] } } }, { actor: 'ai', now, apply: () => { throw new DomainFault('VALIDATION_FAILED', 'Unexpected nested suggestion'); } });
    }
    if (!tx.ops.length) throw new DomainFault('PROTECTED_FIELD', 'Protected field cannot be changed');
    this.validateTransaction(this.state, tx);
    return this.draft(command, tx, now);
  }
  private checkGlobalMcpScope(name: string, actor: CommandEnvelope['actor']) {
    if (actor !== 'mcp' || (!this.ports.mcp?.initiativeIds && !this.ports.mcp?.categoryIds)) return;
    if (/^(category|entity|objective|source|device|settings|suggestion)\./.test(name)) throw new DomainFault('POLICY_DENIED', 'Portfolio command requires unrestricted MCP scope', { rule: PolicyRule.McpScope });
  }
  private addManualProtection(tx: Transaction, command: CommandEnvelope, requested: Transaction['requested']) {
    if (!['user', 'mcp'].includes(command.actor) || command.name === 'field.unprotect') return;
    for (const { kind, id, field } of requested) {
      if (!['initiative', 'node'].includes(kind) || ['protectedFields', 'updatedAt', 'createdAt'].includes(field)) continue;
      let record;
      try { record = tx.get(kind, id); }
      catch (error) { if (error instanceof DomainFault && error.code === 'NOT_FOUND') continue; throw error; }
      const fields = record.protectedFields as string[];
      if (!fields.includes(field)) tx.set(kind, id, 'protectedFields', [...fields, field]);
    }
  }
  private addTimestamps(tx: Transaction, now: string) {
    const changed = new Set(tx.ops.filter(op => op.op === 'set' && ['initiative', 'node', 'edge'].includes(op.kind)).map(op => recordKey(op.kind, op.id)));
    for (const key of changed) {
      const [kind, id] = key.split(':') as [RecordKind, string];
      try { tx.set(kind, id, 'updatedAt', now); } catch (error) { if (!(error instanceof DomainFault && error.code === 'NOT_FOUND')) throw error; }
    }
  }
  private validateTransaction(before: WorkspaceState, tx: Transaction) {
    this.validateErrors(this.ports.validateState({ ...this.replay.document, state: tx.state }));
    const violations = checkAffectedInvariants(before, tx.state, tx.ops.map(op => op.id));
    if (violations.length) throw new DomainFault('INVARIANT_VIOLATION', invariantMessage(violations[0]!.code), { invariant: violations[0]!.code, violations });
  }
  private validateErrors(errors: unknown[]) { if (errors.length) throw new DomainFault('VALIDATION_FAILED', 'Schema validation failed', errors); }
  private draft(command: CommandEnvelope, tx: Transaction, at: string): EventDraft {
    return { v: SCHEMA_VERSION, eventId: tx.eventId, deviceId: this.ports.deviceId, at, actor: command.actor, command: { name: command.name, args: clone(command.args) }, ops: tx.ops,
      ...(command.idempotencyKey ? { idempotencyKey: command.idempotencyKey } : {}), ...(command.runId ? { runId: command.runId } : {}), ...(command.evidenceRefs ? { evidenceRefs: clone(command.evidenceRefs) } : {}) };
  }
  private prepareUndo(command: CommandEnvelope): EventDraft[] {
    if (!['user', 'mcp'].includes(command.actor)) throw new DomainFault('POLICY_DENIED', 'Undo requires a user request', { rule: PolicyRule.ManualPrecedence });
    const targets = command.name === 'change.undo' ? this.replay.events.filter(event => event.eventId === text(command.args.eventId))
      : this.replay.events.filter(event => event.runId === text(command.args.runId));
    if (!targets.length) throw new DomainFault('NOT_FOUND', 'Undo target not found');
    if (targets.some(target => this.replay.events.some(event => event.undoOf === target.eventId))) throw new DomainFault('STALE_BASE', 'Change was already undone');
    const state = clone(this.state); const writers = new Map(this.replay.writers); const logicalWriters = new Map(writers);
    const drafts: EventDraft[] = [];
    for (const target of [...targets].reverse()) {
      const tx = new Transaction(state, writers, this.ports.newId()); const now = this.ports.now();
      const saved = this.replay.before.get(target.eventId)!;
      for (const key of saved.protectionKeys) {
        if (logicalWriters.get(`protection:${key}`) !== target.eventId) throw new DomainFault('STALE_BASE', 'A later protection change conflicts with undo', { field: key });
      }
      for (const before of [...saved.ops].reverse()) {
        const op = before.op;
        if (op.op === 'set' && (op.field === 'updatedAt' || (op.field === 'protectedFields' && !['field.protect', 'field.unprotect'].includes(target.command.name)))) continue;
        const key = op.op === 'set' ? writerKey(op.kind, op.id, op.field!) : recordKey(op.kind, op.id);
        if (logicalWriters.get(key) !== target.eventId) throw new DomainFault('STALE_BASE', 'A later change conflicts with undo', { kind: op.kind, id: op.id, field: op.field });
        if (op.op === 'create') tx.remove(op.kind as Exclude<RecordKind, 'settings'>, op.id);
        else if (op.op === 'tombstone') { if (before.existed) tx.create(op.kind as Exclude<RecordKind, 'settings'>, before.previous); }
        else tx.set(op.kind, op.id, op.field!, before.previous);
        const previousWriter = op.op === 'set' ? op.baseEventId : saved.writers.get(key);
        if (previousWriter) logicalWriters.set(key, previousWriter); else logicalWriters.delete(key);
      }
      for (const op of target.ops) {
        const key = recordKey(op.kind, op.id); const writer = saved.writers.get(key);
        if (writer) logicalWriters.set(key, writer); else logicalWriters.delete(key);
      }
      for (const key of saved.protectionKeys) {
        const writer = saved.writers.get(`protection:${key}`);
        if (writer) logicalWriters.set(`protection:${key}`, writer); else logicalWriters.delete(`protection:${key}`);
      }
      this.addManualProtection(tx, command, [...tx.requested]);
      this.addTimestamps(tx, now);
      if (target.actor === 'ai') recordRejection(tx, { signature: suggestionSignature(target.command), untilNewEvidence: false }, now);
      const scopeOps: Op[] = saved.protectionKeys.map(key => {
        const [kind, id, field] = key.split(':') as [RecordKind, string, string];
        return { op: 'set', kind, id, field, value: null, baseEventId: null };
      });
      this.authorize(command, command, this.state, state, [...tx.ops, ...scopeOps], tx.requested);
      this.validateTransaction(this.state, tx);
      drafts.push({ ...this.draft(command, tx, now), undoOf: target.eventId });
    }
    return drafts;
  }
  private async commit(drafts: EventDraft[]): Promise<CommandResult> {
    for (const draft of drafts) this.validateErrors(this.ports.validateEvent({ ...draft, seq: 1, hlc: '0000000000000-0000' }));
    let committed: ChangeEvent[];
    try { committed = await this.ports.commit(clone(drafts)); }
    catch { throw new DomainFault('WORKSPACE_READ_ONLY', 'Event append failed; no change was acknowledged', { retryable: true }); }
    try {
      if (committed.length !== drafts.length) throw new DomainFault('WORKSPACE_READ_ONLY', 'Driver returned an incomplete commit');
      for (let index = 0; index < drafts.length; index++) {
        const event = committed[index]!; this.validateErrors(this.ports.validateEvent(event));
        for (const [field, value] of Object.entries(drafts[index]!)) if (JSON.stringify(event[field as keyof ChangeEvent]) !== JSON.stringify(value)) throw new DomainFault('WORKSPACE_READ_ONLY', 'Driver altered the committed payload');
      }
      this.replay = replayEvents(this.snapshot, [...this.replay.events, ...committed]);
    } catch (error) { this.readOnly = true; throw error; }
    for (const event of committed) {
      const change = { eventId: event.eventId, actor: event.actor, ops: clone(event.ops), raisedQuestionIds: questionIds(event.ops) };
      for (const listener of this.listeners) { try { listener(clone(change)); } catch { continue; } }
    }
    return resultFor(committed);
  }
  private originalResult(event: ChangeEvent): CommandResult {
    // A run undo may append several events under the same idempotency key.
    return resultFor(event.idempotencyKey ? this.replay.events.filter(item => item.idempotencyKey === event.idempotencyKey) : [event]);
  }
}
function questionIds(ops: Op[]): string[] { return ops.filter(op => op.op === 'create' && op.kind === 'question').map(op => op.id); }
function resultFor(events: ChangeEvent[]): CommandResult {
  const ops = events.flatMap(event => event.ops);
  return { ok: true, eventId: events.at(-1)!.eventId, ops: clone(ops), raisedQuestionIds: questionIds(ops), suggestedAssertionIds: ops.filter(op => op.kind === 'assertion' && op.op === 'create' && op.record?.status === 'suggested').map(op => op.id) };
}
function affectedInitiatives(ops: Op[], before: WorkspaceState, after: WorkspaceState, command: CommandInvocation): string[] {
  const ids = new Set<string>();
  const targets: Target[] = [];
  if (['field.protect', 'field.unprotect', 'evidence.attach', 'evidence.detach'].includes(command.name)) targets.push(parseTarget(command.args.target));
  for (const op of ops) if (op.kind === 'assertion') {
    const assertion = [...before.assertions, ...after.assertions].find(record => record.id === op.id);
    if (assertion) targets.push(assertion.target);
  }
  for (const target of targets) {
    if (target.kind === 'initiative') ids.add(target.id);
    else {
      const records = target.kind === 'node' ? [...before.nodes, ...after.nodes] : [...before.edges, ...after.edges];
      const record = records.find(record => record.id === target.id);
      if (record) ids.add(record.initiativeId);
    }
  }
  for (const op of ops) {
    if (op.kind === 'initiative') ids.add(op.id);
    for (const state of [before, after]) {
      const records = op.kind === 'node' ? state.nodes : op.kind === 'edge' ? state.edges : op.kind === 'question' ? state.questions : op.kind === 'group' ? state.groups : [];
      const record = records.find(record => record.id === op.id);
      if (record) ids.add(record.initiativeId);
      if (op.kind === 'edge' && record) {
        const edge = state.edges.find(edge => edge.id === op.id)!;
        for (const id of [edge.fromId, edge.toId]) { const node = state.nodes.find(node => node.id === id); if (node) ids.add(node.initiativeId); }
      }
    }
  }
  return [...ids];
}
