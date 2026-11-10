import { useEffect, useState } from 'react';
import type { PortfolioBoard, TimelineView as TimelineData } from '@fulcrum/domain';
import type { CoreTransport } from '../core-transport.js';
const AXIS_WIDTH = 800;
const AXIS_INSET = 32;
const ROW_HEIGHT = 40;
const MINIMUM_SPAN = 1;
export function Timeline({ value }: { value: TimelineData }) {
  if (!value.items.length) return <section aria-label="Timeline"><h2>No dated work yet</h2><p>Timeline becomes available when this initiative or its work has a target date. Dates are optional; you can keep using Flow or List.</p></section>;
  const timestamps = value.items.map(item => Date.parse(`${item.date}T00:00:00Z`));
  const first = timestamps[0]!; const last = timestamps.at(-1)!;
  const position = (time: number) => AXIS_INSET + (time - first) / Math.max(last - first, MINIMUM_SPAN) * (AXIS_WIDTH - AXIS_INSET * 2);
  const height = ROW_HEIGHT * (value.items.length + 1);
  return <section className="timeline-view" aria-label="Initiative timeline"><h2>Timeline</h2><p>Target dates and milestones for this work. Dates do not schedule or complete other items.</p>
    <svg className="date-axis" viewBox={`0 0 ${AXIS_WIDTH} ${height}`} aria-hidden="true" focusable="false"><line x1={AXIS_INSET} x2={AXIS_WIDTH-AXIS_INSET} y1={ROW_HEIGHT / 2} y2={ROW_HEIGHT / 2}/>{value.items.map((item,index)=><g key={item.id}><line x1={position(timestamps[index]!)} x2={position(timestamps[index]!)} y1={ROW_HEIGHT / 2} y2={(index+1)*ROW_HEIGHT}/>{item.kind==='milestone'?<path d={`M ${position(timestamps[index]!)} ${(index+1)*ROW_HEIGHT-6} l 6 6 l -6 6 l -6 -6 z`}/>:<circle cx={position(timestamps[index]!)} cy={(index+1)*ROW_HEIGHT} r="4"/>}<text x={AXIS_INSET} y={(index+1)*ROW_HEIGHT+18}>{item.date}</text></g>)}</svg>
    <ol className="timeline-items">{value.items.map(item=><li key={item.id}><time dateTime={item.date}>{item.date}</time><div><a href={item.href}>{item.title}</a><p>{item.kind==='milestone'?'Milestone':item.kind==='initiative'?'Initiative target':item.kind.charAt(0).toUpperCase()+item.kind.slice(1)} · {item.state}</p></div></li>)}</ol>
    {value.prerequisites.length>0&&<section aria-label="Timeline prerequisites"><h3>Prerequisites</h3><ul>{value.prerequisites.map((item,index)=><li key={index}>{item.fromTitle} depends on <a href={item.href}>{item.toTitle}</a></li>)}</ul><p>Prerequisites without dates still gate the work; their dates are not inferred.</p></section>}
  </section>;
}
export function useTimeline(initiativeId: string | undefined, board: PortfolioBoard | undefined, query: CoreTransport['query']) {
  const [read, setRead] = useState<{initiativeId: string; value?: TimelineData; error?: string}>();
  useEffect(()=>{if(!initiativeId||!board)return;let disposed=false;setRead({initiativeId});void query('initiative.timeline',{initiativeId}).then(value=>{if(!disposed)setRead({initiativeId,value});}).catch(()=>{if(!disposed)setRead({initiativeId,error:'Could not load target dates. Retry the core connection.'});});return()=>{disposed=true;};},[initiativeId,board,query]);
  return read?.initiativeId===initiativeId ? read : undefined;
}
