import { expect, test } from 'vitest';
import { projectPriorities } from '../../packages/domain/src/priority-projections.ts';
import { readJson } from '../reference/schemas.mjs';
test('priority rows preserve ties, optional KPIs and evidence while keeping MoSCoW independent',()=>{
 const state=structuredClone(readJson('fixtures/states/portfolio.state.json').state);const before=JSON.stringify(state.initiatives.map(item=>item.moscow));
 for(const objective of state.objectives)objective.rank=2;
 const initiative=state.initiatives.find(item=>item.lifecycle==='active');const source=state.sources[0];source.permalink='javascript:alert(1)';initiative.objectiveLinks=[{objectiveId:state.objectives[0].id,alignment:4,setBy:'ai',evidenceRefs:[{sourceId:source.id}]}];
 const rows=projectPriorities(state);expect(rows.map(row=>row.objective.rank)).toEqual(state.objectives.map(()=>2));expect(rows.find(row=>row.objective.id===state.objectives[0].id).links[0]).toMatchObject({setBy:'ai',alignment:4,evidence:[{id:source.id,title:source.title}]});expect(rows.find(row=>row.objective.id===state.objectives[0].id).links[0].evidence[0].permalink).toBeUndefined();expect(JSON.stringify(state.initiatives.map(item=>item.moscow))).toBe(before);
});
