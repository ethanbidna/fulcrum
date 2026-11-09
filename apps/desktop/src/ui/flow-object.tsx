import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { objectLabels } from './flow-model.js';
import type { ObjectData, ObjectType } from './flow-model.js';
export function ObjectGlyph({ type }: { type: ObjectType }) {
  return <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">{type === 'task' ? <rect x="4" y="4" width="12" height="12" rx="1" /> : type === 'decision' ? <path d="m10 2 8 8-8 8-8-8Z" /> : type === 'dependency' ? <><path d="M5 3h10M5 17h10M6 3v3l8 8v3M14 3v3l-8 8v3" /></> : <><path d="M5 18V3m0 0h11l-3 4 3 4H5" /></>}</svg>;
}
export function FlowObjectView({ data, selected }: NodeProps<Node<ObjectData>>) {
  const { record, reference, busy } = data; const [editing, setEditing] = useState(false); const [title, setTitle] = useState(record.title);
  const completed = ['done', 'satisfied', 'achieved', 'decided'].includes(record.state);
  const semantic = record.state === 'blocked' || record.state === 'expired' ? 'blocked' : record.state === 'waiting' || record.state === 'unverified' ? 'waiting' : completed ? 'completed' : 'open';
  return <div className={`flow-object flow-${record.type} state-${semantic}${record.certainty === 'inferred' ? ' inferred' : ''}${reference ? ' reference' : ''}`}>
    {!reference && <Handle type="target" position={Position.Top} aria-label={`Connect to ${record.title}`} />}
    <div className="flow-object-kind"><ObjectGlyph type={record.type} /><span>{objectLabels[record.type]}</span>{record.certainty === 'inferred' && <span className="inferred-label">Inferred</span>}</div>
    {editing ? <form className="nodrag nowheel node-rename" onSubmit={event => { event.preventDefault(); void data.rename?.(record.id, title.trim()).then(saved => { if (saved) setEditing(false); }); }}><input autoFocus aria-label={`Rename ${record.title}`} value={title} maxLength={300} required onChange={event => setTitle(event.target.value)} disabled={busy} /><div><button disabled={busy || !title.trim()}>Save</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div></form>
      : <><div className="flow-object-title">{record.title}</div><div className="flow-object-footer"><span>{record.state}{reference ? ' · Shared reference' : ''}</span>{selected && !reference && <button className="nodrag" onClick={() => { setTitle(record.title); setEditing(true); }} disabled={busy}>Rename</button>}</div></>}
    {reference && <a className="nodrag reference-home" href={`#initiatives/${record.initiativeId}`}>Open home initiative</a>}
    <Handle type="source" position={Position.Bottom} aria-label={`Connect from ${record.title}`} />
  </div>;
}
