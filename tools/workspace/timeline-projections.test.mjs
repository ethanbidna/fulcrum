import { expect, test } from 'vitest';
import { projectTimeline } from '../../packages/domain/src/timeline-projections.ts';
import { readJson } from '../reference/schemas.mjs';
test('Timeline includes only canonical dated work and keeps undated prerequisites explicit',()=>{
 const state=structuredClone(readJson('fixtures/states/portfolio.state.json').state);const initiative=state.initiatives[0];delete initiative.targetDate;
 for(const node of state.nodes)delete node.targetDate;
 expect(projectTimeline(state,initiative.id).items).toEqual([]);
 const edge=state.edges.find(edge=>edge.initiativeId===initiative.id&&edge.type==='depends_on');const from=state.nodes.find(node=>node.id===edge.fromId);from.targetDate='2026-11-15';
 const target=state.nodes.find(node=>node.id===edge.toId);const result=projectTimeline(state,initiative.id);expect(result.items).toHaveLength(1);expect(result.prerequisites).toContainEqual({fromTitle:from.title,toTitle:target.title,href:`#initiatives/${target.initiativeId}/inspect/node/${target.id}`});expect(target.targetDate).toBeUndefined();
 initiative.targetDate='2026-11-20';expect(projectTimeline(state,initiative.id).items.map(item=>item.date)).toEqual(['2026-11-15','2026-11-20']);
});
