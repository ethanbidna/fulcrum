import type { FlowObject, Moscow, Op } from '@fulcrum/schema';

const validPriority: Moscow = 'must_do';
// @ts-expect-error MoSCoW uses the persisted vocabulary.
const invalidPriority: Moscow = 'must_have';
// @ts-expect-error Nodes require the common graph fields.
const incompleteTask: FlowObject = { type: 'task', state: 'open' };
const scalarChange: Op = { op: 'set', kind: 'initiative', id: 'singleton', field: 'title', value: 'Title', baseEventId: null };
const nullChange: Op = { op: 'set', kind: 'initiative', id: 'singleton', field: 'targetDate', value: null, baseEventId: null };
void [validPriority, invalidPriority, incompleteTask, scalarChange, nullChange];
