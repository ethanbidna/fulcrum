import type { FlowObject, Moscow, Op } from '@fulcrum/schema';

const validPriority: Moscow = 'must_do';
// @ts-expect-error MoSCoW uses the persisted vocabulary.
const invalidPriority: Moscow = 'must_have';
// @ts-expect-error Nodes require the common graph fields.
const incompleteTask: FlowObject = { type: 'task', state: 'open' };
const scalarChange: Op = { op: 'set', kind: 'initiative', id: 'singleton', field: 'title', value: 'Title', baseEventId: null };
const nullChange: Op = { op: 'set', kind: 'initiative', id: 'singleton', field: 'targetDate', value: null, baseEventId: null };
void [validPriority, invalidPriority, incompleteTask, scalarChange, nullChange];

import type { Domain } from '../../packages/domain/src/index.js';
function projectionTypes(domain: Domain) {
  void domain.query('search', { text: 'Synthetic', scope: { kinds: ['node'] } });
  // @ts-expect-error Search kinds are canonical record kinds, not assignees or graph node types.
  void domain.query('search', { text: 'Synthetic', scope: { kinds: ['task'] } });
  void domain.query('graph.focus', { nodeId: 'synthetic' });
  // @ts-expect-error Focus requires a canonical node ID argument.
  void domain.query('graph.focus', { initiativeId: 'synthetic' });
  // @ts-expect-error Unknown read APIs are not part of C5.
  void domain.query('completion.percent', {});
  // @ts-expect-error Queries infer their result type.
  const invalidResult: Promise<number> = domain.query('portfolio.list', {});
  void invalidResult;
}
void projectionTypes;
