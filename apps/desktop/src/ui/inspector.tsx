import { useEffect, useRef, useState } from 'react';
import type { Inspection, InspectionTarget, Node as FlowObject, PortfolioBoard } from '@fulcrum/domain';
import type { CoreTransport } from '../core-transport.js';
import type { ExecuteCommand } from './new-initiative.js';
import { cardStateText } from './portfolio-model.js';
import { objectLabels } from './flow-model.js';
export interface InspectorProps {
  readOnlyReference?: boolean; target: InspectionTarget; initiativeId: string; board: PortfolioBoard; query: CoreTransport['query']; execute: ExecuteCommand;
  close: () => void; select: (id: string) => void; focus: (id: string) => void;
}
export function Inspector({ readOnlyReference = false, target, initiativeId, board, query, execute, close, select, focus }: InspectorProps) {
  const [inspection, setInspection] = useState<Inspection>(); const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    void query('inspector.get', { target }).then(value => { if (!disposed) { setInspection(value); setError(''); } }).catch(() => { if (!disposed) { setInspection(undefined); setError('The selected object is unavailable. Select another object to continue.'); } });
    return () => { disposed = true; };
  }, [target.kind, target.id, board, query]);
  return <aside className="object-inspector" aria-label="Inspector"><div className="inspector-heading"><h2>Inspector</h2><button className="secondary-button" onClick={close} aria-label="Hide inspector">Hide</button></div>{error ? <p role="alert" className="command-error">{error}</p> : !inspection || inspection.record.id !== target.id ? <p role="status">Loading selection…</p> : <InspectionView key={`${target.kind}:${target.id}`} value={inspection} readOnlyReference={readOnlyReference} initiativeId={initiativeId} execute={execute} select={select} focus={focus} />}</aside>;
}
function InspectionView({ value, readOnlyReference, initiativeId, execute, select, focus }: { value: Inspection; readOnlyReference: boolean; initiativeId: string; execute: ExecuteCommand; select: (id: string) => void; focus: (id: string) => void }) {
  const reference = value.kind === 'node' && (readOnlyReference || value.record.initiativeId !== initiativeId);
  const heading = value.kind === 'edge' ? 'Relationship' : value.record.title;
  return <><h3 className="inspector-object-title">{heading}</h3><p className="inspector-kind">{value.kind === 'node' ? objectLabels[value.record.type] : value.kind === 'edge' ? value.record.type.replaceAll('_', ' ') : 'Initiative'}{'certainty' in value.record && value.record.certainty === 'inferred' ? ' · Inferred' : ''}</p>
    {reference ? <p>This is a prerequisite reference. <a href={`#initiatives/${value.record.initiativeId}`}>Open its home initiative</a> to edit it.</p> : value.kind === 'node' ? <details className="direct-edit"><summary>Edit directly</summary><NodeAttributes node={value.record} execute={execute} /><NodeState node={value.record} execute={execute} /></details> : value.kind === 'edge' ? <EdgeAttributes value={value} execute={execute} /> : <><p>{value.record.description || 'No description.'}</p>{value.cardState && <p className="inspector-current-action">{cardStateText({ initiative: value.record, cardState: value.cardState })}</p>}</>}
    <dl className="inspector-facts">{value.kind === 'node' && <><dt>State</dt><dd>{value.record.state}</dd></>}{'targetDate' in value.record && typeof value.record.targetDate === 'string' && <><dt>Due</dt><dd>{value.record.targetDate}</dd></>}{value.attribution.responsible && <><dt>External responsibility</dt><dd>{value.attribution.responsible}</dd></>}{value.attribution.decider && <><dt>Decider</dt><dd>{value.attribution.decider}</dd></>}<dt>Evidence sources</dt><dd>{value.evidenceCount}</dd></dl>
    {value.kind === 'node' && value.record.type === 'task' && !reference && <button className="secondary-button focus-task" onClick={() => focus(value.record.id)}>Focus task</button>}
    {value.kind === 'node' && !reference && value.children.length > 0 && <ChildChecklist children={value.children} readOnly={reference} execute={execute} select={select} />}
    <section className="inspector-section" aria-label="Contextual questions"><h3>Questions <span>{value.questions.length}</span></h3>{value.questions.length ? <ul>{value.questions.map(question => <li key={question.id}>{question.prompt}</li>)}</ul> : <p>No open questions on this object.</p>}</section></>;
}
function NodeAttributes({ node, execute }: { node: FlowObject; execute: ExecuteCommand }) {
  const dirtyRef = useRef(false);
  const [title, setTitle] = useState(node.title); const [details, setDetails] = useState(node.details ?? ''); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (!dirtyRef.current) { setTitle(node.title); setDetails(node.details ?? ''); } }, [node.title, node.details]);
  const save = async () => {
    if (busy || !title.trim()) return; setBusy(true); setError('');
    try { const result = await execute({ name: 'node.update', args: { id: node.id, patch: { title: title.trim(), details } } }); if (result.ok) { dirtyRef.current = false; setDirty(false); } else setError(result.error.message); }
    catch { setError('Could not save attributes. Check the core connection and retry.'); }
    finally { setBusy(false); }
  };
  return <form className="inspector-form" onSubmit={event => { event.preventDefault(); void save(); }} aria-label="Node attributes"><label>Title<input value={title} required maxLength={300} onChange={event => { setTitle(event.target.value); dirtyRef.current = true; setDirty(true); }} disabled={busy} /></label><label>Details<textarea value={details} maxLength={8000} rows={3} onChange={event => { setDetails(event.target.value); dirtyRef.current = true; setDirty(true); }} disabled={busy} /></label><button className="primary-button" disabled={busy || !dirty || !title.trim()}>Save attributes</button>{dirty && <p className="draft-note">Unsaved attributes</p>}{error && <p role="alert" className="command-error">{error}</p>}</form>;
}
const states = { task: ['open', 'done', 'cancelled'], dependency: ['waiting', 'satisfied', 'blocked', 'expired', 'unverified', 'cancelled'], milestone: ['pending', 'achieved', 'missed', 'cancelled'], decision: ['open', 'decided', 'cancelled'] } as const;
function NodeState({ node, execute }: { node: FlowObject; execute: ExecuteCommand }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [outcome, setOutcome] = useState('');
  const change = async (state: string) => {
    if (busy) return; setBusy(true); setError('');
    try { const result = await execute(node.type === 'decision' && state === 'decided' ? { name: 'decision.decide', args: { id: node.id, outcome } } : { name: 'node.setState', args: { id: node.id, state } }); if (!result.ok) setError(result.error.message); }
    catch { setError('Could not save state. Retry after checking the connection.'); }
    finally { setBusy(false); }
  };
  return <div className="inspector-form"><label>State<select value={node.state} disabled={busy} onChange={event => { void change(event.target.value); }}>{states[node.type].map(state => <option key={state} value={state} disabled={node.type === 'decision' && state === 'decided'}>{state}</option>)}</select></label>{node.type === 'decision' && <form onSubmit={event => { event.preventDefault(); void change('decided'); }}><label>Outcome<select value={outcome} disabled={busy} onChange={event => setOutcome(event.target.value)}><option value="">Choose an outcome</option>{node.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><button className="secondary-button" disabled={busy || !outcome}>Record decision</button></form>}{error && <p role="alert" className="command-error">{error}</p>}</div>;
}
function EdgeAttributes({ value, execute }: { value: Inspection & { kind: 'edge' }; execute: ExecuteCommand }) {
  const [label, setLabel] = useState(value.record.label ?? ''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { setLabel(value.record.label ?? ''); }, [value.record.label]);
  return <form className="inspector-form" onSubmit={event => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); void execute({ name: 'edge.update', args: { id: value.record.id, patch: { label } } }).then(result => { if (!result.ok) setError(result.error.message); }).catch(() => setError('Could not save the relationship label. Try again.')).finally(() => setBusy(false)); }}><p>{value.relationship?.fromTitle} {value.record.type.replaceAll('_', ' ')} {value.relationship?.toTitle}</p><label>Label<input value={label} maxLength={80} disabled={busy} onChange={event => setLabel(event.target.value)} /></label><button className="primary-button" disabled={busy || label === (value.record.label ?? '')}>Save label</button>{value.record.condition && <p>Conditional route: {value.relationship?.conditionLabel ?? 'Unknown option'}</p>}{error && <p className="command-error" role="alert">{error}</p>}</form>;
}
function ChildChecklist({ children, readOnly, execute, select }: { children: FlowObject[]; readOnly: boolean; execute: ExecuteCommand; select: (id: string) => void }) {
  const [pending, setPending] = useState<string>(); const [error, setError] = useState('');
  const toggle = async (node: FlowObject) => {
    if (pending) return; setPending(node.id); setError('');
    try { const result = await execute({ name: 'node.setState', args: { id: node.id, state: node.state === 'done' ? 'open' : 'done' } }); if (!result.ok) setError(result.error.message); }
    catch { setError('Could not save the child Task. Try again.'); } finally { setPending(undefined); }
  };
  return <section className="inspector-section" aria-label="Child Tasks"><h3>Child Tasks</h3><p>Containment organizes work; it does not create prerequisites.</p><ul className="child-checklist">{children.map(node => <li key={node.id}><input type="checkbox" aria-label={`Complete ${node.title}`} checked={node.state === 'done'} disabled={readOnly || !!pending || node.type !== 'task' || node.state === 'cancelled'} onChange={() => { void toggle(node); }} /><button className="child-task-link" onClick={() => select(node.id)}>{node.title}</button><span>{node.state}</span></li>)}</ul>{error && <p role="alert" className="command-error">{error}</p>}</section>;
}
