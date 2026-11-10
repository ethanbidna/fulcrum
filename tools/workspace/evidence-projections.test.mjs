import { expect, test } from 'vitest';
import { projectEvidence, safeOriginal } from '../../packages/domain/src/evidence-projections.ts';
import { readJson } from '../reference/schemas.mjs';
const fixture = () => structuredClone(readJson('fixtures/states/portfolio.state.json').state);
test('Context aggregates initiative, node, edge and assertion evidence once per source, with exact object scope', () => {
 const state = fixture(); const initiative = state.initiatives[0]; const node = state.nodes.find(item=>item.initiativeId===initiative.id); const edge = state.edges.find(item=>item.initiativeId===initiative.id); const source = state.sources[0];
 for(const record of [initiative,node,edge])record.evidenceRefs=[{sourceId:source.id}];
 state.assertions=[{id:'05000000-0000-7000-8000-000000000099',target:{kind:'node',id:node.id,field:'title'},predicate:'title',value:'Synthetic claim',certainty:'inferred',status:'suggested',evidenceRefs:[{sourceId:source.id}],observedAt:source.ingestedAt}];
 const rows=projectEvidence(state,{initiativeId:initiative.id}); const row=rows.find(item=>item.sourceId===source.id);
 expect(row.targets.map(item=>item.kind)).toEqual(expect.arrayContaining(['initiative','node','edge'])); expect(row.assertions).toHaveLength(1);
 const scoped=projectEvidence(state,{initiativeId:initiative.id,target:{kind:'node',id:node.id}}); expect(scoped).toHaveLength(1); expect(scoped[0].targets).toHaveLength(1);
 expect(()=>projectEvidence(state,{initiativeId:initiative.id,target:{kind:'node',id:'unrelated'}})).toThrow();
});
test('unsafe original links and uncached excerpts cannot leak; absent sources remain visible',()=>{
 const state=fixture();const initiative=state.initiatives[0];const source=state.sources[0];source.permalink='javascript:alert(1)';source.cachePolicy='none';source.excerpt='Must stay hidden';initiative.evidenceRefs=[{sourceId:source.id},{sourceId:'missing'}];
 const rows=projectEvidence(state,{initiativeId:initiative.id});const row=rows.find(item=>item.sourceId===source.id);expect(row.source.permalink).toBeUndefined();expect(row.source.excerpt).toBeUndefined();expect(rows.find(item=>item.sourceId==='missing').source).toBeUndefined();
 expect(safeOriginal('https://user:secret@example.test/')).toBeUndefined();expect(safeOriginal('https://example.test/source')).toBe('https://example.test/source');
});
