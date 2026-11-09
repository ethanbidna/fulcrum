import { useState } from 'react';
import type { GraphView } from '@fulcrum/domain';
import { connectionRecord, newObject, objectLabels, relationshipLabels } from './flow-model.js';
import type { ObjectType, Relationship } from './flow-model.js';
import type { ExecuteCommand } from './new-initiative.js';
export function AddObject({ initiativeId, execute, close }: { initiativeId: string; execute: ExecuteCommand; close: () => void }) {
  const [type, setType] = useState<ObjectType>('task'); const [title, setTitle] = useState(''); const [choices, setChoices] = useState(['', '']);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async () => {
    if (busy || !title.trim()) return; setBusy(true); setError('');
    try { const result = await execute({ name: 'node.create', args: { record: newObject(initiativeId, type, title, crypto.randomUUID(), choices) } }); if (result.ok) close(); else setError(result.error.message); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not add node. Try again.'); }
    finally { setBusy(false); }
  };
  return <form className="flow-edit-form" aria-label="Add node" onSubmit={event => { event.preventDefault(); void submit(); }}><label>Type<select value={type} onChange={event => setType(event.target.value as ObjectType)} disabled={busy}>{Object.entries(objectLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Title<input autoFocus value={title} maxLength={300} required onChange={event => setTitle(event.target.value)} disabled={busy} /></label>
    {type === 'decision' && <><p>You make this decision. Enter its two possible routes.</p>{choices.map((choice, index) => <label key={index}>Option {index + 1}<input value={choice} required maxLength={120} onChange={event => setChoices(choices.map((value, item) => item === index ? event.target.value : value))} disabled={busy} /></label>)}</>}
    <div className="toolbar-actions"><button className="primary-button" disabled={busy || !title.trim()}>Add node</button><button className="secondary-button" type="button" disabled={busy} onClick={close}>Cancel</button></div>{error && <p className="command-error" role="alert">{error}</p>}</form>;
}
export function ConnectObjects({ graph, connection: initialConnection, execute, close }: { graph: GraphView; connection: { source: string; target: string }; execute: ExecuteCommand; close: () => void }) {
  const [connection, setConnection] = useState(initialConnection);
  const [type, setType] = useState<Relationship>('depends_on'); const [optionId, setOptionId] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const all = [...graph.nodes, ...graph.references]; const source = all.find(node => node.id === connection.source); const target = all.find(node => node.id === connection.target);
  const submit = async () => {
    if (busy) return; setBusy(true); setError('');
    try { const record = connectionRecord(graph, connection, type, crypto.randomUUID(), optionId); const result = await execute({ name: 'edge.create', args: { record } }); if (result.ok) close(); else setError(result.error.message); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not connect nodes. Try again.'); }
    finally { setBusy(false); }
  };
  return <form className="flow-edit-form" aria-label="Connect nodes" onSubmit={event => { event.preventDefault(); void submit(); }}><label>From<select value={connection.source} disabled={busy} onChange={event => { setConnection({ ...connection, source: event.target.value }); setOptionId(''); }}>{all.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label><label>To<select value={connection.target} disabled={busy} onChange={event => setConnection({ ...connection, target: event.target.value })}>{all.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label><p><strong>{source?.title ?? 'Source'}</strong> → <strong>{target?.title ?? 'Target'}</strong></p><label>Relationship<select autoFocus value={type} onChange={event => { setType(event.target.value as Relationship); setOptionId(''); }} disabled={busy}>{Object.entries(relationshipLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><p>{type === 'depends_on' ? `${target?.title} depends on ${source?.title}.` : type === 'contains' ? 'Organizational membership only; it does not create a prerequisite.' : type === 'leads_to' ? 'Sequence or a conditional route from a Decision.' : 'An association with no execution constraint.'}</p>
    {type === 'leads_to' && source?.type === 'decision' && <label>Route<select value={optionId} onChange={event => setOptionId(event.target.value)} disabled={busy}><option value="">Unconditional</option>{source.options!.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
    <div className="toolbar-actions"><button className="primary-button" disabled={busy}>Create relationship</button><button className="secondary-button" type="button" disabled={busy} onClick={close}>Cancel</button></div>{error && <p role="alert" className="command-error">{error}</p>}</form>;
}
