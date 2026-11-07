/** Generated from schemas/v1. Run pnpm schema:generate; do not edit. */

/**
 * Stable UUID. UUIDv7 recommended so IDs sort by creation time.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Id".
 */
export type Id = string;
/**
 * Hybrid logical clock: 13-digit epoch ms, 4-digit counter. Lexicographic order = causal-compatible total order (ties broken by deviceId, then seq).
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Hlc".
 */
export type Hlc = string;
/**
 * RFC 3339 UTC timestamp.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Timestamp".
 */
export type Timestamp = string;
/**
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Actor".
 */
export type Actor = "user" | "ai" | "connector" | "mcp" | "system";
/**
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "EvidenceRefs".
 */
export type EvidenceRefs = EvidenceRef[];
/**
 * This interface was referenced by `ChangeEvent`'s JSON-Schema
 * via the `definition` "op".
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Op".
 */
export type Op = {
  op: "create" | "set" | "tombstone";
  kind: RecordKind;
  /**
   * Record id (or 'singleton' for settings).
   */
  id: string;
  /**
   * create only: full record.
   */
  record?: {
    [k: string]: unknown;
  };
  /**
   * set only.
   */
  field?: string;
  /**
   * set only: new value (null clears).
   */
  value?: unknown;
  /**
   * set only: eventId of the last write to this field that the author had seen (null if none). Used for concurrent-edit detection.
   */
  baseEventId?: Id | null;
};
/**
 * This interface was referenced by `ChangeEvent`'s JSON-Schema
 * via the `definition` "recordKind".
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "RecordKind".
 */
export type RecordKind =
  | "initiative"
  | "category"
  | "node"
  | "edge"
  | "group"
  | "objective"
  | "entity"
  | "source"
  | "assertion"
  | "question"
  | "rejection"
  | "device"
  | "settings";
/**
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Date".
 */
export type Date = string;
/**
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Moscow".
 */
export type Moscow = "must_do" | "should_do" | "could_do" | "wont_do";
/**
 * explicit = stated in the source; inferred = model interpretation.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Certainty".
 */
export type Certainty = "explicit" | "inferred";
/**
 * Questions are only raised for medium or high materiality; low-materiality ambiguity is dropped.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Materiality".
 */
export type Materiality = "medium" | "high";
/**
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "FieldName".
 */
export type FieldName = string;
/**
 * First-class node in exactly one initiative's canonical graph. There is no nested graph: child Tasks are ordinary nodes linked by 'contains' edges.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "FlowObject".
 */
export type FlowObjectGraphNode = {
  id: Id;
  initiativeId: Id;
  type: "task" | "dependency" | "decision" | "milestone";
  title: string;
  details?: string;
  /**
   * Stable UUID. UUIDv7 recommended so IDs sort by creation time.
   */
  groupId?: string;
  targetDate?: Date;
  certainty?: Certainty;
  /**
   * AND/OR prerequisites. Incoming depends_on edges reference a group id; edges with no group are ANDed. Groups are ANDed with each other.
   */
  prerequisiteGroups?: {
    id: string;
    mode: "all" | "any";
  }[];
  supersededBy?: Id;
  manualRank?: string;
  protectedFields: FieldName[];
  evidenceRefs?: EvidenceRefs;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  [k: string]: unknown;
} & FlowObject;
export type FlowObject =
  | TaskOnlyTheUserSOwnWork
  | DependencyAnythingOutsideTheUserSDirectExecution
  | DecisionExplicitChoiceOutcomeSelectsConditionalLeadsToEdges
  | MilestoneCheckpointNeverAPercentage;

export interface SchemaDefinitions {
  [k: string]: unknown;
}
/**
 * One line in log/<deviceId>/*.jsonl. Immutable. The result of exactly one domain command (or one atomic batch). Events are the authority; checkpoints and indexes are derived.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "ChangeEvent".
 */
export interface ChangeEvent {
  /**
   * Event schema version; old versions are upcast on read, never rewritten.
   */
  v: number;
  eventId: Id;
  deviceId: Id;
  /**
   * Contiguous per-device sequence starting at 1.
   */
  seq: number;
  hlc: Hlc;
  at: Timestamp;
  actor: Actor;
  command: CommandInvocation;
  /**
   * Caller-supplied key; a repeated key is a no-op. Connectors use connector:remoteId.
   */
  idempotencyKey?: string;
  /**
   * Groups AI/connector events from one reconciliation run so they can be undone together.
   */
  runId?: string;
  undoOf?: Id;
  evidenceRefs?: EvidenceRefs;
  /**
   * Resolved, field-level mutations the command produced. Replay applies ops; it never re-executes command logic.
   */
  ops: Op[];
}
/**
 * This interface was referenced by `ChangeEvent`'s JSON-Schema
 * via the `definition` "commandInvocation".
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "CommandInvocation".
 */
export interface CommandInvocation {
  name: string;
  args: {
    [k: string]: unknown;
  };
}
/**
 * Points from a claim/object/edge to the source that supports it.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "EvidenceRef".
 */
export interface EvidenceRef {
  sourceId: Id;
  assertionId?: Id;
  /**
   * Optional character range within the cached excerpt.
   */
  range?: {
    start: number;
    end: number;
  };
}
/**
 * Attachment point for evidence and questions: the initiative, one node, or one edge; optionally a single field.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Target".
 */
export interface Target {
  kind: "initiative" | "node" | "edge";
  id: Id;
  field?: string;
}
/**
 * Edges read as sentences: <fromId> <type> <toId>. 'A depends_on B' means B is a prerequisite of A. 'A contains B' means B is organizationally inside Task A (never a prerequisite). 'A leads_to B' is sequence / conditional route. Renderers draw depends_on arrows prerequisite -> dependent.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "FlowEdge".
 */
export interface FlowEdge {
  id: Id;
  /**
   * Stable UUID. UUIDv7 recommended so IDs sort by creation time.
   */
  initiativeId: string;
  fromId: Id;
  toId: Id;
  type: "contains" | "depends_on" | "leads_to" | "related_to";
  /**
   * depends_on only: id of a prerequisiteGroups entry on the fromId node.
   */
  prerequisiteGroupId?: string;
  /**
   * leads_to only, and only from a Decision: route is live when the decision outcome equals optionId.
   */
  condition?: {
    optionId: string;
  };
  label?: string;
  certainty?: Certainty;
  evidenceRefs?: EvidenceRefs;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
/**
 * No responsibleEntityId/assignee/owner: unevaluatedProperties rejects any such field on a Task.
 */
export interface TaskOnlyTheUserSOwnWork {
  type?: "task";
  state?: "open" | "done" | "cancelled";
  [k: string]: unknown;
}
export interface DependencyAnythingOutsideTheUserSDirectExecution {
  type?: "dependency";
  state?: "waiting" | "satisfied" | "blocked" | "expired" | "unverified" | "cancelled";
  kind?: "person" | "approval" | "access" | "delivery" | "event" | "technical" | "other";
  responsibleEntityId?: Id;
  lastCheckedAt?: Timestamp;
  [k: string]: unknown;
}
export interface DecisionExplicitChoiceOutcomeSelectsConditionalLeadsToEdges {
  type?: "decision";
  state?: "open" | "decided" | "cancelled";
  /**
   * 'user' or an entity id when someone else decides (then it behaves as a Dependency for actionability).
   */
  decider: "user" | Id;
  /**
   * @minItems 2
   */
  options: [
    {
      id: string;
      label: string;
    },
    {
      id: string;
      label: string;
    },
    ...{
      id: string;
      label: string;
    }[]
  ];
  outcome?: string;
  [k: string]: unknown;
}
export interface MilestoneCheckpointNeverAPercentage {
  type?: "milestone";
  state?: "pending" | "achieved" | "missed" | "cancelled";
  [k: string]: unknown;
}
/**
 * Top-level portfolio card. Not a flow node: the initiative is the canvas, not a node inside it.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Initiative".
 */
export interface Initiative {
  id: Id;
  title: string;
  description?: string;
  /**
   * proposed = AI suggestion awaiting approval; never shown as active until approved.
   */
  lifecycle: "proposed" | "active" | "paused" | "completed" | "archived" | "rejected";
  moscow: Moscow | null;
  /**
   * Fractional index string for manual ordering (e.g. 'a0', 'a0V').
   */
  manualRank?: string;
  categoryIds: Id[];
  teamEntityId?: Id;
  objectiveLinks?: {
    objectiveId: Id;
    /**
     * 1 (weak) to 5 (direct).
     */
    alignment: number;
    setBy: Actor;
    evidenceRefs?: EvidenceRefs;
  }[];
  targetDate?: Date;
  /**
   * Fields AI may not change silently. moscow is protected by default; any manual user edit adds the field.
   */
  protectedFields: FieldName[];
  evidenceRefs?: EvidenceRefs;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
/**
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Category".
 */
export interface Category {
  id: Id;
  label: string;
  manualRank?: string;
}
/**
 * Visual grouping on the canvas. Presentation construct only.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Group".
 */
export interface Group {
  id: Id;
  initiativeId: Id;
  label: string;
}
/**
 * Portfolio-level strategic objective. Ranked independently of MoSCoW; equal rank = tie.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Objective".
 */
export interface Objective {
  id: Id;
  label: string;
  rank: number;
  /**
   * Optional relative emphasis 1-5.
   */
  weight?: number;
  kpi?: {
    name: string;
    unit?: string;
    target?: number;
    current?: number;
    asOf?: Date;
  };
  evidenceRefs?: EvidenceRefs;
}
/**
 * Persistent identity for people, teams, orgs, systems. Merge/split history lives in the change log.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Entity".
 */
export interface Entity {
  id: Id;
  type: "person" | "team" | "org" | "system" | "initiative_alias" | "other";
  label: string;
  aliases: string[];
  /**
   * Connector-scoped identifiers, e.g. {connector:'slack', remoteId:'U123'}.
   */
  externalIds?: {
    connector: string;
    remoteId: string;
  }[];
  mergedInto?: Id;
}
/**
 * Pointer to an external item plus optional retained excerpt. happenedAt = event time; ingestedAt = when Fulcrum learned of it.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Source".
 */
export interface Source {
  id: Id;
  connector: string;
  /**
   * Dedup key with connector.
   */
  remoteId: string;
  threadRemoteId?: string;
  permalink?: string;
  title?: string;
  senderEntityId?: Id;
  happenedAt?: Timestamp;
  ingestedAt: Timestamp;
  /**
   * none = pointer + hash only; excerpt = short excerpt stored in workspace.
   */
  cachePolicy: "none" | "excerpt";
  excerpt?: string;
  contentHash: string;
}
/**
 * Evidence-backed temporal claim. Not authoritative state until reconciled by the domain engine.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Assertion".
 */
export interface Assertion {
  id: Id;
  target: Target;
  predicate: string;
  value: unknown;
  /**
   * @minItems 1
   */
  evidenceRefs: [EvidenceRef, ...EvidenceRef[]];
  observedAt: Timestamp;
  validFrom?: Timestamp;
  validTo?: Timestamp;
  certainty: Certainty;
  status: "pending" | "applied" | "suggested" | "rejected" | "superseded" | "conflicting";
  supersededBy?: Id;
}
/**
 * Quiet contextual clarification attached to an initiative, node or edge. Not a flow object.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Question".
 */
export interface Question {
  id: Id;
  initiativeId: Id;
  target: Target;
  prompt: string;
  reason?:
    | "ambiguous_evidence"
    | "conflicting_sources"
    | "protected_field_challenge"
    | "identity_ambiguity"
    | "sync_conflict"
    | "proposed_initiative";
  evidenceRefs?: EvidenceRefs;
  /**
   * 2-3 concrete choices; each carries the domain commands to run if chosen. Defer is always implicit.
   *
   * @minItems 2
   * @maxItems 3
   */
  resolutions:
    | [
        {
          id: string;
          label: string;
          commands: CommandInvocation[];
        },
        {
          id: string;
          label: string;
          commands: CommandInvocation[];
        }
      ]
    | [
        {
          id: string;
          label: string;
          commands: CommandInvocation[];
        },
        {
          id: string;
          label: string;
          commands: CommandInvocation[];
        },
        {
          id: string;
          label: string;
          commands: CommandInvocation[];
        }
      ];
  state: "open" | "deferred" | "resolved" | "obsolete";
  materiality: Materiality;
  /**
   * Same key = same question; new evidence updates rather than duplicates.
   */
  dedupeKey: string;
  deferredUntil?: Timestamp;
  resolvedWith?: string;
  createdAt: Timestamp;
}
/**
 * Remembered user rejection so the same AI suggestion is not reintroduced.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Rejection".
 */
export interface Rejection {
  signature: string;
  rejectedAt: Timestamp;
  untilNewEvidence?: boolean;
}
/**
 * Materialized state after folding a set of events. Written as checkpoints/<deviceId>/<hlc>.json. Also the shape of synthetic state fixtures.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "WorkspaceState".
 */
export interface WorkspaceStateCheckpointBody {
  v: number;
  workspaceId: Id;
  /**
   * deviceId -> highest contiguous seq included. Empty for hand-written fixtures.
   */
  frontier: {
    [k: string]: number;
  };
  maxHlc?: Hlc;
  /**
   * "kind:id:field" -> eventId of the last write folded into this checkpoint. Required for concurrent-edit detection when replaying on top of a checkpoint.
   */
  fieldWriters?: {
    [k: string]: Id;
  };
  state: {
    initiatives: Initiative[];
    categories: Category[];
    nodes: FlowObjectGraphNode[];
    edges: FlowEdge[];
    groups: Group[];
    objectives: Objective[];
    entities: Entity[];
    sources: Source[];
    assertions: Assertion[];
    questions: Question[];
    rejections: Rejection[];
    devices?: {
      id: Id;
      /**
       * User-chosen name. No serial numbers or paths.
       */
      label: string;
    }[];
    /**
     * Synced workspace settings only. Machine-local settings live outside the workspace.
     */
    settings: {
      ingestionDeviceId?: Id | null;
      defaultCachePolicy?: "none" | "excerpt";
    };
  };
}
/**
 * Written once at creation and on schema migration only. Never holds categories, preferences that change often, credentials or device paths.
 *
 * This interface was referenced by `SchemaDefinitions`'s JSON-Schema
 * via the `definition` "Workspace".
 */
export interface WorkspaceJsonManifest {
  format: "fulcrum-workspace";
  schemaVersion: number;
  workspaceId: Id;
  createdAt: Timestamp;
  /**
   * Oldest app schemaVersion that may open this workspace read-only.
   */
  minReaderVersion?: number;
  /**
   * Reserved. Absent = plaintext workspace.
   */
  encryption?: {
    scheme: string;
    keyId: string;
  };
}
