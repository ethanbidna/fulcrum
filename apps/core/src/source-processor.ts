import { createHash } from 'node:crypto';
import type { CommandEnvelope } from '@fulcrum/domain';
import { extractSource, reconcile } from '@fulcrum/ingest';
import type { ReconciliationPlan } from '@fulcrum/ingest';
import type { ModelRuntime } from '@fulcrum/llm';
import type { EntityResolution } from '@fulcrum/context';
import type { Entity, WorkspaceStateDoc } from '@fulcrum/schema';
import type { SourceItem } from '@fulcrum/sources';

const ID_HASH_HEX_DIGITS = 9;
const ID_NUMBER_WIDTH = 12;
const NO_INITIATIVE = 'no-matching-initiative';

export interface SourceProcessorPorts {
  snapshot(): WorkspaceStateDoc;
  runtime: ModelRuntime;
  userEntityId: string;
  /** Addresses that identify the user as an author. */
  selfAddresses(): string[];
  /** Runs commands in order; the plan is available to the domain's proof check while they run. */
  submit(commands: CommandEnvelope[], plan?: ReconciliationPlan): Promise<void>;
  now(): string;
}

type Context = { signal: AbortSignal; idempotencyKey: string };

// Deterministic so a repeated run produces the same ids and the domain deduplicates it.
function stableId(key: string): string {
  const number = parseInt(createHash('sha256').update(key).digest('hex').slice(0, ID_HASH_HEX_DIGITS), 16);
  return `09000000-0000-7000-8000-${String(number).padStart(ID_NUMBER_WIDTH, '0')}`;
}

const normalized = (text: string) => text.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
const people = (snapshot: WorkspaceStateDoc): Entity[] => snapshot.state.entities.filter(entity => !entity.mergedInto);

function matchingInitiative(snapshot: WorkspaceStateDoc, text: string): string {
  const haystack = normalized(text);
  const mentioned = snapshot.state.initiatives
    .filter(initiative => initiative.title.trim() && haystack.includes(normalized(initiative.title)))
    .sort((a, b) => b.title.length - a.title.length);
  return mentioned[0]?.id ?? NO_INITIATIVE;
}

function senderEntityId(snapshot: WorkspaceStateDoc, ports: SourceProcessorPorts, authorId: string): string | undefined {
  const author = normalized(authorId);
  if (ports.selfAddresses().some(address => normalized(address) === author)) return ports.userEntityId;
  return people(snapshot).find(entity => [entity.label, ...entity.aliases].some(name => normalized(name) === author))?.id;
}

function resolutionsFor(snapshot: WorkspaceStateDoc, mentions: string[]): EntityResolution[] {
  return mentions.flatMap((text): EntityResolution[] => {
    const matches = people(snapshot).filter(entity => [entity.label, ...entity.aliases].some(name => normalized(name) === normalized(text)));
    if (matches.length === 1) return [{ mention: { text }, status: 'resolved', entityId: matches[0]!.id }];
    if (matches.length > 1) return [{ mention: { text }, status: 'ambiguous', candidateIds: matches.map(entity => entity.id), candidates: matches }];
    return [];
  });
}

function recordSource(snapshot: WorkspaceStateDoc, ports: SourceProcessorPorts, item: SourceItem, key: string): CommandEnvelope {
  const existing = snapshot.state.sources.find(source => source.connector === item.connector && source.remoteId === item.remoteId);
  const sender = senderEntityId(snapshot, ports, item.authorId);
  const record = {
    id: existing?.id ?? stableId(`source:${item.connector}:${item.remoteId}`),
    connector: item.connector, remoteId: item.remoteId, happenedAt: item.happenedAt, ingestedAt: ports.now(),
    // Mail bodies stay out of the synced workspace: only a pointer and a hash are kept.
    cachePolicy: 'none' as const, contentHash: `sha256:${createHash('sha256').update(item.text).digest('hex')}`,
    ...(item.threadRemoteId ? { threadRemoteId: item.threadRemoteId } : {}),
    ...(item.permalink ? { permalink: item.permalink } : {}),
    ...(sender ? { senderEntityId: sender } : {}),
  };
  return { name: 'source.record', actor: 'connector', args: { record }, idempotencyKey: `source:${key}` } as CommandEnvelope;
}

export function createSourceProcessor(ports: SourceProcessorPorts) {
  return async function process(item: SourceItem, context: Context): Promise<void> {
    const before = ports.snapshot();
    const user = before.state.entities.find(entity => entity.id === ports.userEntityId);
    const extraction = await extractSource(ports.runtime, item, { userIdentity: user?.label ?? 'the user', signal: context.signal });
    if (!extraction.ok) throw new Error(`EXTRACTION_${extraction.code.toUpperCase()}`);
    if (!extraction.candidates.length) return;

    await ports.submit([recordSource(before, ports, item, context.idempotencyKey)]);
    const snapshot = ports.snapshot();
    const source = snapshot.state.sources.find(record => record.connector === item.connector && record.remoteId === item.remoteId);
    if (!source) throw new Error('SOURCE_NOT_RECORDED');

    const mentions = extraction.candidates.flatMap(candidate => candidate.kind === 'external_commitment' ? [candidate.who] : []);
    const plan = reconcile({
      candidates: extraction.candidates, resolutions: resolutionsFor(snapshot, mentions), snapshot,
      rejections: snapshot.state.rejections, sourceId: source.id, sourceText: item.text,
      initiativeId: matchingInitiative(snapshot, item.text), userEntityId: ports.userEntityId,
      runId: context.idempotencyKey, observedAt: ports.now(), idForKey: stableId,
    });
    await ports.submit([...plan.commands, ...plan.suggestions, ...plan.questions], plan);
  };
}
