import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { InitiativeListRow, InitiativeHistoryEntry, InspectionTarget, PortfolioBoard } from '@fulcrum/domain';
import type { CoreTransport } from '../core-transport.js';
import type { ExecuteCommand } from './new-initiative.js';
interface Props {initiativeId:string;board:PortfolioBoard;query:CoreTransport['query'];execute:ExecuteCommand;onInspectionChange:(target:InspectionTarget|undefined)=>void}
export function ListView({initiativeId,board,query,execute,onInspectionChange}:Props){
  const [rows,setRows]=useState<InitiativeListRow[]>();const [error,setError]=useState('');
  useEffect(()=>{let disposed=false;setError('');void query('initiative.list',{initiativeId}).then(value=>{if(!disposed)setRows(value);}).catch(()=>{if(!disposed)setError('Could not load the list. Return to Flow or retry the connection.');});return()=>{disposed=true;};},[initiativeId,board,query]);
  if(error&&!rows)return <p role="alert">{error}</p>;
  if(!rows)return <p role="status">Opening the list…</p>;
  return <section aria-label="Initiative list">{error&&<p role="alert">{error}</p>}<div className="detail-view-heading"><h2>List</h2><p>Same work, arranged by containment. Enter or leave a title to save; Escape cancels.</p></div>{rows.length?<div className="list-scroll" role="region" aria-label="Scrollable work list" tabIndex={0}><table className="work-list"><caption className="visually-hidden">Canonical flow objects. Indentation means containment, not execution order.</caption><thead><tr><th scope="col">Work</th><th scope="col">Type</th><th scope="col">State</th><th scope="col">Role</th><th scope="col">Date</th><th scope="col">Prerequisites</th><th scope="col">Sources</th></tr></thead><tbody>{rows.map(row=><WorkRow key={row.node.id} row={row} execute={execute} inspect={onInspectionChange}/>)}</tbody></table></div>:<p>No work here yet. Describe what you want to add in the command input.</p>}</section>;
}
function WorkRow({row,execute,inspect}:{row:InitiativeListRow;execute:ExecuteCommand;inspect:Props['onInspectionChange']}){
  const {node}=row;const [draft,setDraft]=useState(node.title);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const dirty=useRef(false);const saving=useRef(false);
  useEffect(()=>{if(!dirty.current)setDraft(node.title);},[node.title]);
  const save=async()=>{
    if(saving.current||draft===node.title)return;
    if(!draft.trim()){setError('A title is required. Your text is kept.');return;}
    saving.current=true;setBusy(true);setError('');
    try{const result=await execute({name:'node.update',args:{id:node.id,patch:{title:draft.trim()}}});if(result.ok){dirty.current=false;}else setError(result.error.message);}
    catch{setError('Could not save the title. Check the connection and retry.');}finally{saving.current=false;setBusy(false);}
  };
  return <tr><th scope="row" style={{'--row-depth':row.depth} as CSSProperties}><input aria-label={`Title for ${node.title}`} maxLength={300} value={draft} disabled={busy} onFocus={()=>inspect({kind:'node',id:node.id})} onChange={event=>{dirty.current=true;setDraft(event.target.value);}} onBlur={()=>{void save();}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void save();}if(event.key==='Escape'){event.preventDefault();dirty.current=false;setDraft(node.title);setError('');}}}/>{row.parentId&&<span className="visually-hidden">Child Task</span>}{error&&<p className="command-error" role="alert">{error}</p>}</th><td>{node.type}</td><td>{node.state}</td><td>{row.role}</td><td>{node.targetDate??'—'}</td><td>{row.prerequisites.length?<ul>{row.prerequisites.map(item=><li key={item.id}><a href={`#initiatives/${item.initiativeId}`}>{item.title}</a></li>)}</ul>:'—'}</td><td>{row.sourceCount}</td></tr>;
}
const actors={user:'You',ai:'Local AI',connector:'Connector',mcp:'MCP',system:'System'};
export function HistoryView({initiativeId,board,query,execute}:Props){
  const [entries,setEntries]=useState<InitiativeHistoryEntry[]>();const [error,setError]=useState('');const [busy,setBusy]=useState<string>();const active=useRef(false);
  useEffect(()=>{let disposed=false;setError('');void query('initiative.history',{initiativeId}).then(value=>{if(!disposed)setEntries(value);}).catch(()=>{if(!disposed){setEntries(undefined);setError('Could not load history. Return to Flow or retry the connection.');}});return()=>{disposed=true;};},[initiativeId,board,query]);
  const undo=async(entry:InitiativeHistoryEntry,mode:'event'|'run')=>{
    if(active.current)return;active.current=true;setBusy(entry.eventId);setError('');
    try{const result=await execute(mode==='run'?{name:'run.undo',args:{runId:entry.runId!}}:{name:'change.undo',args:{eventId:entry.eventId}});if(!result.ok)setError(result.error.message);}
    catch{setError('Could not undo. Check the connection and retry.');}finally{active.current=false;setBusy(undefined);}
  };
  return <section aria-label="Initiative history"><div className="detail-view-heading"><h2>History</h2><p>Recorded changes and the evidence behind them. Undo adds a compensating event.</p></div>{error&&<p role="alert" className="command-error">{error}</p>}{!entries&&!error?<p role="status">Opening history…</p>:entries?.length?<ol className="history-ledger">{entries.map((entry,index)=><li key={entry.eventId}><article><header><div><h3>{entry.command.name}</h3><p>{actors[entry.actor]} · <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>{entry.undoOf?' · Undo':entry.undone?' · Undone':''}</p></div>{!entry.undoOf&&!entry.undone&&<button className="text-action" disabled={!!busy} onClick={()=>{void undo(entry,'event');}}>{busy===entry.eventId?'Undoing…':'Undo change'}</button>}</header><details open={index===0}><summary>{entry.changes.length} {entry.changes.length===1?'change':'changes'}</summary><ul className="history-changes">{entry.changes.map((change,number)=><li key={`${change.id}:${number}`}><p>{change.label}</p><dl><dt>Before</dt><dd>{change.beforeText}</dd><dt>After</dt><dd>{change.afterText}</dd></dl></li>)}</ul>{entry.evidence.length?<div className="history-evidence"><h4>Evidence</h4><ul>{entry.evidence.map(source=><li key={source.id}>{source.permalink?<a href={source.permalink} target="_blank" rel="noreferrer">{source.title}</a>:<span>{source.title} · no original link</span>}</li>)}</ul></div>:<p className="history-note">No evidence was attached to this event.</p>}{entry.actor==='ai'&&entry.runId&&!entry.undoOf&&!entry.undone&&<div className="history-run"><p>This AI run contains {entry.runEventCount} events across {entry.runInitiativeCount} initiatives. Undo applies to the whole run.</p><button className="text-action" disabled={!!busy} onClick={()=>{void undo(entry,'run');}}>Undo AI run</button></div>}</details></article></li>)}</ol>:!error&&<p>No recorded changes for this initiative yet.</p>}</section>;
}
