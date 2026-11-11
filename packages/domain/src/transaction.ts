import type { Op, RecordKind } from '@fulcrum/schema';
import type { WorkspaceState } from './types.js';
import { clone, COLLECTIONS, DomainFault, object, recordKey, text, writerKey } from './commands.js';
import type { DataRecord } from './commands.js';

export interface BeforeOp { op: Op; previous: DataRecord | unknown; existed: boolean }
export class Transaction {
  readonly ops: Op[] = [];
  readonly before: BeforeOp[] = [];
  readonly requested: { kind: RecordKind; id: string; field: string }[] = [];
  constructor(readonly state: WorkspaceState, readonly writers: Map<string, string>, readonly eventId: string) {}
  list(kind: Exclude<RecordKind, 'settings'>): DataRecord[] { return (this.state[COLLECTIONS[kind]] ?? []) as unknown as DataRecord[]; }
  get(kind: RecordKind, id: string): DataRecord {
    if (kind === 'settings') return this.state.settings as DataRecord;
    const record = this.list(kind).find(record => (kind === 'rejection' ? record.signature : record.id) === id);
    if (!record) throw new DomainFault('NOT_FOUND', 'Record not found', { kind, id });
    return record;
  }
  create(kind: Exclude<RecordKind, 'settings'>, value: unknown) {
    const record = clone(object(value));
    const id = text(kind === 'rejection' ? record.signature : record.id);
    if (this.list(kind).some(record => (kind === 'rejection' ? record.signature : record.id) === id)) {
      throw new DomainFault('INVARIANT_VIOLATION', 'Duplicate record id', { invariant: 'DUPLICATE_ID', id });
    }
    if (kind === 'device' && !this.state.devices) this.state.devices = [];
    this.list(kind).push(record);
    const op: Op = { op: 'create', kind, id, record };
    this.ops.push(op); this.before.push({ op, previous: null, existed: false });
    for (const field of Object.keys(record)) this.writers.set(writerKey(kind, id, field), this.eventId);
    this.writers.set(recordKey(kind, id), this.eventId);
  }
  set(kind: RecordKind, id: string, field: string, value: unknown) {
    if (['id', 'signature', '__proto__', 'prototype', 'constructor'].includes(field)) throw new DomainFault('VALIDATION_FAILED', 'Immutable or reserved field');
    const record = this.get(kind, id);
    this.requested.push({ kind, id, field });
    if (JSON.stringify(record[field] ?? null) === JSON.stringify(value)) return;
    const op: Op = { op: 'set', kind, id, field, value: clone(value), baseEventId: this.writers.get(writerKey(kind, id, field)) ?? null };
    this.before.push({ op, previous: clone(record[field] ?? null), existed: Object.hasOwn(record, field) });
    if (value === null && !(kind === 'initiative' && field === 'moscow')) delete record[field]; else record[field] = clone(value);
    this.ops.push(op); this.writers.set(writerKey(kind, id, field), this.eventId);
    this.writers.set(recordKey(kind, id), this.eventId);
  }
  remove(kind: Exclude<RecordKind, 'settings'>, id: string) {
    const record = this.get(kind, id);
    const records = this.list(kind);
    records.splice(records.indexOf(record), 1);
    const op: Op = { op: 'tombstone', kind, id };
    this.before.push({ op, previous: clone(record), existed: true }); this.ops.push(op);
    this.writers.set(recordKey(kind, id), this.eventId);
  }
}
