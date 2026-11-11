import type { Assertion, Entity, EvidenceRef, Source, Target } from '@fulcrum/schema';
export interface Mention { text: string; type?: Entity['type']; externalId?: { connector: string; remoteId: string } }
export type EntityResolution = { mention: Mention } & (
  | { status: 'resolved'; entityId: string }
  | { status: 'ambiguous'; candidateIds: string[]; candidates: Entity[] }
  | { status: 'unresolved' }
);
export interface ContextRecord { target: Target; title: string; initiativeId: string; entityIds: string[]; evidenceRefs: EvidenceRef[] }
export type Episode =
  | { kind: 'entity'; record: Entity }
  | { kind: 'source'; record: Source }
  | { kind: 'assertion'; record: Assertion }
  | { kind: 'target'; record: ContextRecord };
export type ContextTarget = Target | { kind: 'entity'; id: string } | { kind: 'text'; text: string };
export interface RelatedContext { entities: Entity[]; targets: ContextRecord[]; sources: Source[]; assertions: Assertion[] }
export interface ContextIndex {
  ingest(episode: Episode): Promise<void>;
  resolveEntities(mentions: Mention[]): Promise<EntityResolution[]>;
  related(target: ContextTarget, limit: number): Promise<RelatedContext>;
  rebuild(from: AsyncIterable<Episode>): Promise<void>;
  close(): Promise<void>;
}
export interface ContextOptions { localDirectory: string; workspaceDirectory: string; workspaceId: string }
