import type { Source } from '@fulcrum/schema';
import type { Node, WorkspaceState } from './types.js';
import type { Replay } from './replay.js';
import type { HistoryEntry, HistoryChange } from './history-projections.js';
import { projectHistory } from './history-projections.js';
import { projectGraph } from './graph-projections.js';

export interface InitiativeListRow {
  node: Node; depth: number; parentId?: string; role: string; sourceCount: number;
  prerequisites: { id: string; title: string; initiativeId: string }[];
}
export interface EvidenceLink { id: string; title: string; permalink?: string }
export interface DescribedChange extends HistoryChange { label: string; beforeText: string; afterText: string }
export interface InitiativeHistoryEntry extends Omit<HistoryEntry,'changes'> {
  changes: DescribedChange[]; evidence: EvidenceLink[]; undone: boolean;
  runEventCount: number; runInitiativeCount: number;
}
export function projectInitiativeList(state: WorkspaceState, initiativeId: string): InitiativeListRow[] {
  const graph = projectGraph(state,initiativeId);
  const parents = new Map(graph.edges.filter(edge=>edge.type==='contains').map(edge=>[edge.toId,edge.fromId]));
  const rows: InitiativeListRow[] = []; const visited = new Set<string>();
  const visit = (node: Node, depth: number) => {
    if(visited.has(node.id))return; visited.add(node.id);
    const parentId = parents.get(node.id);
    const entity = (id: string|undefined) => state.entities.find(item=>item.id===id)?.label;
    const role = node.type==='task' ? 'You' : node.type==='decision' ? node.decider==='user'?'You':entity(node.decider)??'External decider' : node.type==='dependency' ? entity(node.responsibleEntityId)??'External' : 'Checkpoint';
    const prerequisites = graph.edges.filter(edge=>edge.type==='depends_on'&&edge.fromId===node.id).flatMap(edge=>{
      const target=state.nodes.find(item=>item.id===edge.toId);return target?[{id:target.id,title:target.title,initiativeId:target.initiativeId}]:[];
    });
    rows.push({node,depth,role,sourceCount:new Set((node.evidenceRefs??[]).map(ref=>ref.sourceId)).size,prerequisites,...(parentId?{parentId}:{})});
    for(const child of graph.nodes.filter(item=>parents.get(item.id)===node.id))visit(child,depth+1);
  };
  for(const node of graph.nodes.filter(item=>!parents.has(item.id)))visit(node,0);
  return rows;
}
function asRecord(value:unknown):Record<string,unknown>|undefined {
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
}
function evidenceLink(source: Source): EvidenceLink {
  let permalink: string|undefined;
  try { const url=new URL(source.permalink??'');if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)permalink=url.href; } catch { /* A source may have no original link. */ }
  return {id:source.id,title:source.title??'Recorded evidence',...(permalink?{permalink}:{})};
}
export function projectInitiativeHistory(replay: Replay, initiativeId: string): InitiativeHistoryEntry[] {
  const state = replay.document.state as WorkspaceState; projectGraph(state,initiativeId);
  const history=projectHistory(replay);
  const records=new Map<string,Record<string,unknown>>();
  for(const collection of [state.initiatives,state.nodes,state.edges,state.groups,state.sources,state.entities,state.categories])for(const record of collection)records.set(record.id,record as unknown as Record<string,unknown>);
  const currentIds=new Set(records.keys());
  for(const entry of [...history].reverse())for(const change of entry.changes)for(const value of [change.before,change.after]){
    const record=asRecord(value);if(record&&typeof record.id==='string'&&!currentIds.has(record.id))records.set(record.id,record);
  }
  const home=(change:HistoryChange):string|undefined=>change.kind==='initiative'?change.id:String(records.get(change.id)?.initiativeId??'')||undefined;
  const title=(id:unknown):string=>{
    const record=records.get(String(id));
    if(record?.fromId&&record.toId)return `${title(record.fromId)} ${String(record.type).replaceAll('_',' ')} ${title(record.toId)}`;
    return String(record?.title??record?.label??record?.prompt??(id==='user'?'You':id));
  };
  const display=(value:unknown,field?:string):string=>{
    if(value===null||value===undefined)return 'Not set';
    if(Array.isArray(value))return value.map(item=>display(item,field)).join(' · ');
    if(field==='moscow')return ({must_do:'Must Do',should_do:'Should Do',could_do:'Could Do',wont_do:"Won't Do"} as Record<string,string>)[String(value)]??String(value);
    if(typeof value!=='object')return field?.endsWith('Id')||field?.endsWith('Ids')?title(value):String(value);
    return Object.entries(value).filter(([key])=>!['id','initiativeId','createdAt','updatedAt','protectedFields','evidenceRefs'].includes(key)).map(([key,item])=>`${key.replace(/Ids?$/,'').replace(/([A-Z])/g,' $1')}: ${display(item,key)}`).join(' · ');
  };
  const undone=new Set(history.flatMap(entry=>entry.undoOf?[entry.undoOf]:[]));
  return history.filter(entry=>entry.changes.some(change=>home(change)===initiativeId)).map(entry=>{
    const run=entry.runId?history.filter(item=>item.runId===entry.runId&&!item.undoOf):[];
    const sourceIds=new Set([...entry.evidenceRefs,...entry.changes.flatMap(change=>{
      const record=asRecord(change.after)??asRecord(change.before);return Array.isArray(record?.evidenceRefs)?record.evidenceRefs as {sourceId:string}[]:[];
    })].map(ref=>ref.sourceId));
    const evidence=[...sourceIds].flatMap(id=>{const source=records.get(id);return source?[evidenceLink(source as unknown as Source)]:[{id,title:'Evidence unavailable'}];});
    const changes=entry.changes.filter(change=>['initiative','node','edge','group','question','assertion'].includes(change.kind)&&!['createdAt','updatedAt'].includes(change.field??'')&&(change.field!=='protectedFields'||entry.command.name.startsWith('field.'))).map(change=>({
      ...change,label:`${change.operation==='create'?'Create':change.operation==='tombstone'?'Remove':'Change'} ${change.field??change.kind}: ${title(change.id)}`,beforeText:display(change.before,change.field),afterText:display(change.after,change.field),
    }));
    return {...entry,changes,evidence,undone:undone.has(entry.eventId),runEventCount:run.length,runInitiativeCount:new Set(run.flatMap(item=>item.changes.map(home).filter(Boolean))).size};
  });
}
