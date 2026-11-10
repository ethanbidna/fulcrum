import { useEffect, useRef, useState } from 'react';
import type { Objective } from '@fulcrum/schema';
import type { CommandEnvelope, PortfolioBoard, PriorityRow } from '@fulcrum/domain';
import type { CoreTransport } from '../core-transport.js';
import type { ExecuteCommand } from './new-initiative.js';
const MINIMUM_RANK = 1;
const SCALE_VALUES = [1,2,3,4,5];
interface Props { board: PortfolioBoard; query: CoreTransport['query']; execute: ExecuteCommand }
export function Priorities({board,query,execute}:Props){
  const [rows,setRows]=useState<PriorityRow[]>();const [error,setError]=useState('');const [adding,setAdding]=useState(false);const [retry,setRetry]=useState(0);
  useEffect(()=>{let disposed=false;setError('');void query('priorities.list',{}).then(value=>{if(!disposed)setRows(value);}).catch(()=>{if(!disposed){setRows(undefined);setError('Could not load priorities. Retry to load the current objectives.');}});return()=>{disposed=true;};},[board,query,retry]);
  return <section className="priorities-view" aria-label="Strategic priorities"><header className="detail-view-heading"><h2>Strategic objectives</h2><p>Lower ranks come first; equal ranks are ties. Objective ranking is independent of initiative MoSCoW.</p></header>{error&&<><p role="alert">{error}</p><button onClick={()=>setRetry(value=>value+1)}>Retry priorities</button></>}{!rows&&!error?<p role="status">Loading priorities…</p>:rows&&<>{rows.length?<ol className="priority-list">{rows.map(row=><li key={row.objective.id}><ObjectiveEditor row={row} board={board} execute={execute}/></li>)}</ol>:<p>No objectives yet. Add one to explain what matters across your initiatives.</p>}{adding?<ObjectiveForm execute={execute} nextRank={Math.max(0,...rows.map(row=>row.objective.rank))+MINIMUM_RANK} close={()=>setAdding(false)}/>:<button className="secondary-button" onClick={()=>setAdding(true)}>Add objective</button>}</>}</section>;
}
function useObjectiveWrite(execute:ExecuteCommand){
  const active=useRef(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const save=async(command:Omit<CommandEnvelope,'actor'>)=>{if(active.current)return false;active.current=true;setBusy(true);setError('');try{const result=await execute(command);if(!result.ok){setError(result.error.message);return false;}return true;}catch{setError('Could not save. Your values are kept; check the connection and retry.');return false;}finally{active.current=false;setBusy(false);}};
  return {save,busy,error};
}
export function ObjectiveForm({objective,nextRank,execute,close}:{objective?:Objective;nextRank:number;execute:ExecuteCommand;close:()=>void}){
  const [label,setLabel]=useState(objective?.label??'');const [rank,setRank]=useState(String(objective?.rank??nextRank));const [weight,setWeight]=useState(String(objective?.weight??''));
  const [kpiName,setKpiName]=useState(objective?.kpi?.name??'');const [unit,setUnit]=useState(objective?.kpi?.unit??'');const [target,setTarget]=useState(String(objective?.kpi?.target??''));const [current,setCurrent]=useState(String(objective?.kpi?.current??''));const [asOf,setAsOf]=useState(objective?.kpi?.asOf??'');
  const {save,busy,error}=useObjectiveWrite(execute);
  const submit=async()=>{
    const kpi=kpiName.trim()?{name:kpiName.trim(),...(unit?{unit}:{}),...(target!==''?{target:Number(target)}:{}),...(current!==''?{current:Number(current)}:{}),...(asOf?{asOf}:{})}:null;
    const patch={label:label.trim(),weight:weight?Number(weight):null,kpi};
    const commands: Omit<CommandEnvelope, 'actor'> = objective
      ? { name: 'command.apply', args: { commands: [
        { name: 'objective.update', args: { id: objective.id, patch } },
        { name: 'objective.rerank', args: { ranks: [{ id: objective.id, rank: Number(rank) }] } },
      ] } }
      : { name: 'objective.create', args: { record: {
        id: crypto.randomUUID(), label: label.trim(), rank: Number(rank),
        ...(weight ? { weight: Number(weight) } : {}), ...(kpi ? { kpi } : {}),
      } } };
    if(await save(commands))close();
  };
  return <form className="objective-form inspector-form" aria-label={objective?'Edit objective':'New objective'} onSubmit={event=>{event.preventDefault();void submit();}}><fieldset disabled={busy}><legend>{objective?'Edit objective':'New objective'}</legend><label>Name<input required maxLength={160} value={label} onChange={event=>setLabel(event.target.value)}/></label><label>Rank<input required type="number" min={MINIMUM_RANK} step="1" value={rank} onChange={event=>setRank(event.target.value)}/></label><label>Relative weight<select value={weight} onChange={event=>setWeight(event.target.value)}><option value="">Not set</option>{SCALE_VALUES.map(value=><option key={value} value={value}>{value}</option>)}</select></label><details open={!!objective?.kpi}><summary>Optional KPI</summary><label>KPI name<input value={kpiName} onChange={event=>setKpiName(event.target.value)}/></label><label>Unit<input value={unit} onChange={event=>setUnit(event.target.value)}/></label><label>Target<input type="number" step="any" value={target} onChange={event=>setTarget(event.target.value)}/></label><label>Current<input type="number" step="any" value={current} onChange={event=>setCurrent(event.target.value)}/></label><label>As of<input type="date" value={asOf} onChange={event=>setAsOf(event.target.value)}/></label></details><div className="form-actions"><button className="primary-button">{busy?'Saving…':'Save objective'}</button><button type="button" className="secondary-button" onClick={close}>Cancel</button></div></fieldset>{error&&<p role="alert">{error}</p>}</form>;
}
function ObjectiveEditor({row,board,execute}:{row:PriorityRow;board:PortfolioBoard;execute:ExecuteCommand}){
  const [editing,setEditing]=useState(false);const [initiativeId,setInitiativeId]=useState('');const [alignment,setAlignment]=useState('3');const {save,busy,error}=useObjectiveWrite(execute);
  return <article><header className="priority-heading"><div><h3>{row.objective.label}</h3><p>Rank {row.objective.rank}{row.objective.weight?` · Weight ${row.objective.weight}`:''}</p></div><button className="text-action" onClick={()=>setEditing(value=>!value)}>{editing?'Close editor':'Edit objective'}</button></header>{editing&&<ObjectiveForm objective={row.objective} nextRank={row.objective.rank} execute={execute} close={()=>setEditing(false)}/>}
    {row.objective.kpi&&<dl className="inspector-facts"><dt>KPI</dt><dd>{row.objective.kpi.name}</dd><dt>Current</dt><dd>{row.objective.kpi.current??'Not recorded'} {row.objective.kpi.unit}</dd><dt>Target</dt><dd>{row.objective.kpi.target??'Not set'} {row.objective.kpi.unit}</dd><dt>As of</dt><dd>{row.objective.kpi.asOf??'Not recorded'}</dd></dl>}
    <h4>Linked initiatives</h4>{row.links.length?<ul>{row.links.map(link=><li key={link.initiativeId}><a href={`#initiatives/${link.initiativeId}`}>{link.title}</a> · Alignment {link.alignment}/5 · {link.setBy==='ai'?'AI estimate':link.setBy==='user'?'Your estimate':link.setBy}<ul>{link.evidence.map(source=><li key={source.id}>{source.permalink?<a href={source.permalink} target="_blank" rel="noreferrer">{source.title} (opens in new window)</a>:<span>{source.title}</span>}</li>)}</ul>{link.setBy==='ai'&&!link.evidence.length&&<p>Evidence was not retained for this estimate.</p>}</li>)}</ul>:<p>No initiatives linked.</p>}
    <form className="alignment-form" aria-label={`Set alignment for ${row.objective.label}`} onSubmit={event=>{event.preventDefault();void save({name:'alignment.set',args:{initiativeId,objectiveId:row.objective.id,alignment:Number(alignment)}});}}><label>Initiative<select required value={initiativeId} disabled={busy} onChange={event=>{setInitiativeId(event.target.value);setAlignment(String(row.links.find(link=>link.initiativeId===event.target.value)?.alignment??3));}}><option value="">Choose an initiative</option>{board.cards.map(card=><option key={card.initiative.id} value={card.initiative.id}>{card.initiative.title}</option>)}</select></label><label>Alignment<select value={alignment} disabled={busy} onChange={event=>setAlignment(event.target.value)}>{SCALE_VALUES.map(value=><option key={value} value={value}>{value}</option>)}</select></label><button className="secondary-button" disabled={busy||!initiativeId}>Save alignment</button></form>{error&&<p role="alert">{error}</p>}
  </article>;
}
