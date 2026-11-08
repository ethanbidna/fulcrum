// Reference fold: event set -> state + concurrent-edit conflicts.
// Deterministic for any arrival order: events are deduped, totally ordered by
// (hlc, deviceId, seq) and applied as field-level last-writer-wins.
// See docs/WORKSPACE_FORMAT.md#merge-semantics.

const COLLECTION_BY_KIND = {
  initiative: 'initiatives', category: 'categories', node: 'nodes', edge: 'edges', group: 'groups',
  objective: 'objectives', entity: 'entities', source: 'sources', assertion: 'assertions',
  question: 'questions', rejection: 'rejections', device: 'devices',
};
const SETTINGS_KIND = 'settings';

// Concurrent edits to these fields raise a sync_conflict Question; others resolve silently (and show in History).
export const MATERIAL_FIELDS = {
  initiative: ['moscow', 'lifecycle', 'title'],
  node: ['state', 'outcome', 'title', 'type'],
  edge: ['type', 'fromId', 'toId', 'condition'],
};

export function compareEvents(a, b) {
  if (a.hlc !== b.hlc) return a.hlc < b.hlc ? -1 : 1;
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
  return a.seq - b.seq;
}

export function emptyState() {
  const state = Object.fromEntries(Object.values(COLLECTION_BY_KIND).map(c => [c, new Map()]));
  state.settings = {};
  return state;
}

export function fold(events, { base = emptyState(), baseWriters = new Map() } = {}) {
  const state = base;
  const writers = new Map(baseWriters); // "kind:id:field" -> eventId of last write
  const tombstones = new Set();
  const conflicts = [];
  const sorted = dedupe(events).sort(compareEvents);
  for (const event of sorted) {
    for (const op of event.ops) applyOp(state, writers, tombstones, conflicts, event, op);
  }
  return { state, conflicts, frontier: frontierOf(sorted), order: sorted.map(e => e.eventId) };
}

function dedupe(events) {
  const seen = new Map();
  for (const e of events) if (!seen.has(e.eventId)) seen.set(e.eventId, e);
  return [...seen.values()];
}

function applyOp(state, writers, tombstones, conflicts, event, op) {
  if (op.kind === SETTINGS_KIND) return applySettings(state, writers, conflicts, event, op);
  const collection = state[COLLECTION_BY_KIND[op.kind]];
  const recordKey = `${op.kind}:${op.id}`;
  if (op.op === 'create') return applyCreate(collection, writers, tombstones, conflicts, event, op, recordKey);
  if (op.op === 'tombstone') {
    collection.delete(op.id);
    tombstones.add(recordKey);
    return;
  }
  const record = collection.get(op.id);
  if (!record) {
    conflicts.push({ type: tombstones.has(recordKey) ? 'write_after_delete' : 'missing_record', kind: op.kind, id: op.id, field: op.field, eventId: event.eventId, material: true });
    return;
  }
  const writerKey = `${recordKey}:${op.field}`;
  detectConcurrentWrite(writers, conflicts, event, op, writerKey, record[op.field]);
  setField(record, op.field, op.value, op.kind);
  writers.set(writerKey, event.eventId);
}

function applyCreate(collection, writers, tombstones, conflicts, event, op, recordKey) {
  if (collection.has(op.id) || (tombstones.has(recordKey) && !event.undoOf)) {
    conflicts.push({ type: 'duplicate_create', kind: op.kind, id: op.id, eventId: event.eventId, material: false });
    return;
  }
  tombstones.delete(recordKey);
  collection.set(op.id, structuredClone(op.record));
  for (const field of Object.keys(op.record)) writers.set(`${recordKey}:${field}`, event.eventId);
}

function applySettings(state, writers, conflicts, event, op) {
  const writerKey = `settings:singleton:${op.field}`;
  detectConcurrentWrite(writers, conflicts, event, op, writerKey, state.settings[op.field]);
  setField(state.settings, op.field, op.value, 'settings');
  writers.set(writerKey, event.eventId);
}

// A write is concurrent when its author had not seen the current last write of that field.
function detectConcurrentWrite(writers, conflicts, event, op, writerKey, currentValue) {
  const currentWriter = writers.get(writerKey) ?? null;
  if (currentWriter === op.baseEventId) return;
  conflicts.push({
    type: 'concurrent_write', kind: op.kind, id: op.id, field: op.field,
    values: [currentValue, op.value], eventIds: [currentWriter, event.eventId],
    winner: event.eventId, material: (MATERIAL_FIELDS[op.kind] ?? []).includes(op.field),
  });
}

function setField(record, field, value, kind) {
  if (value === null && !(kind === 'initiative' && field === 'moscow')) delete record[field];
  else record[field] = value;
}

function frontierOf(sortedEvents) {
  const seqsByDevice = new Map();
  for (const e of sortedEvents) {
    if (!seqsByDevice.has(e.deviceId)) seqsByDevice.set(e.deviceId, new Set());
    seqsByDevice.get(e.deviceId).add(e.seq);
  }
  const frontier = {};
  for (const [deviceId, seqs] of seqsByDevice) {
    let n = 0;
    while (seqs.has(n + 1)) n += 1;
    frontier[deviceId] = n;
  }
  return frontier;
}

// Plain-object view of a folded state, matching workspace-state.schema.json#/properties/state.
export function toStateDocument(state) {
  const doc = { settings: { ...state.settings } };
  for (const collection of Object.values(COLLECTION_BY_KIND)) doc[collection] = [...state[collection].values()];
  return doc;
}

export function fromStateDocument(doc) {
  const state = emptyState();
  for (const collection of Object.values(COLLECTION_BY_KIND)) {
    for (const record of doc[collection] ?? []) state[collection].set(collection === 'rejections' ? record.signature : record.id, structuredClone(record));
  }
  state.settings = { ...doc.settings };
  return state;
}

// A checkpoint is usable only if every event outside its frontier sorts after it;
// otherwise LWW order would differ from a full replay and the reader must fall back.
export function checkpointIsUsable(checkpoint, events) {
  const outside = events.filter(e => e.seq > (checkpoint.frontier[e.deviceId] ?? 0));
  return outside.every(e => e.hlc > checkpoint.maxHlc);
}
