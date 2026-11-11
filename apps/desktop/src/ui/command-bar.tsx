import { useEffect, useRef, useState } from 'react';
import { MAX_COMMAND_PROMPT_LENGTH } from '@fulcrum/domain';
import type { CommandPlan, CommandRequest, CommandResult, InspectionTarget } from '@fulcrum/domain';
interface Props {
  target?: InspectionTarget;
  available?: boolean;
  initiativeId?: string;
  plan(request: CommandRequest): Promise<CommandPlan>;
  apply(id: string): Promise<CommandResult>;
  cancel(): Promise<void>;
  undo(eventId: string): Promise<CommandResult>;
}
export function CommandBar({ available = true, target, initiativeId, plan, apply, cancel, undo }: Props) {
  const input = useRef<HTMLInputElement>(null); const status = useRef<HTMLParagraphElement>(null);
  const generation = useRef(0);
  const [prompt, setPrompt] = useState(''); const [preview, setPreview] = useState<CommandPlan>();
  const [phase, setPhase] = useState<'idle'|'planning'|'applying'>('idle');
  const [error, setError] = useState(''); const [applied, setApplied] = useState<{eventId:string;count:number}>();
  const busy = phase !== 'idle';
  useEffect(() => { generation.current++; setPreview(undefined); setError(''); setPhase('idle'); void cancel().catch(()=>{}); }, [initiativeId, target?.kind, target?.id, cancel]);
  useEffect(() => { if (!available) { generation.current++; setPreview(undefined); setPhase('idle'); void cancel().catch(()=>{}); } }, [available,cancel]);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.current?.focus(); input.current?.select(); } };
    window.addEventListener('keydown',focus); return () => { generation.current++; window.removeEventListener('keydown',focus); void cancel().catch(()=>{}); };
  }, [cancel]);
  const review = async () => {
    if (!available || busy || !prompt.trim()) return; const current = ++generation.current;
    setPhase('planning'); setError(''); setPreview(undefined); setApplied(undefined);
    try { const value = await plan({prompt:prompt.trim(),...(initiativeId ? {initiativeId} : {}),...(target ? {target} : {})}); if (current === generation.current) setPreview(value); }
    catch (value) { if (current === generation.current) setError(value instanceof Error ? value.message : 'Could not plan this request. Your text is kept.'); }
    finally { if (current === generation.current) setPhase('idle'); }
  };
  const approve = async () => {
    if (!preview || busy) return; const current = ++generation.current; setPhase('applying'); setError('');
    try { const result = await apply(preview.id); if (current !== generation.current) return; if (!result.ok) {setError(result.error.message);return;} setApplied({eventId:result.eventId,count:preview.changes.length}); setPreview(undefined); setPrompt(''); requestAnimationFrame(()=>status.current?.focus()); }
    catch { if (current === generation.current) setError('Could not apply the command. Your request is kept; check the core connection and retry.'); }
    finally {if (current === generation.current) setPhase('idle');}
  };
  const dismiss = () => { if (phase === 'applying') return; generation.current++; setPreview(undefined); setError(''); setPhase('idle'); void cancel().catch(()=>{}); input.current?.focus(); };
  const undoCommand = async () => {
    if (!applied || busy) return; setPhase('applying'); setError('');
    try { const result = await undo(applied.eventId); if (result.ok) setApplied(undefined); else setError(result.error.message); }
    catch {setError('Could not undo this command. Check the connection and retry.');} finally {setPhase('idle');}
  };
  return <section className="command-entry" aria-label="Command bar" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();dismiss();}if((event.metaKey||event.ctrlKey)&&event.key==='Enter'&&preview){event.preventDefault();void approve();}}}>
    <form className="command-input" onSubmit={event=>{event.preventDefault();void review();}}>
      <label className="visually-hidden" htmlFor="work-command">What would you like to change?</label>
      <input ref={input} id="work-command" autoComplete="off" maxLength={MAX_COMMAND_PROMPT_LENGTH} value={prompt} disabled={phase==='applying'} placeholder="Describe a change to your work…" aria-describedby="command-help" onChange={event=>{generation.current++;setPrompt(event.target.value);setPreview(undefined);setError('');if(phase==='planning'){setPhase('idle');void cancel().catch(()=>{});}}} />
      <span className="command-shortcut" aria-hidden="true">⌘K</span>
      <button className="command-submit" type="submit" disabled={!available||busy||!prompt.trim()} aria-label="Review command"><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5"/></svg></button>
    </form>
    <p id="command-help" className="command-help">{!available ? 'Connect to the local core to review this request.' : <>Enter to review changes{preview ? ' · ⌘Enter to apply · Escape to dismiss' : ' · planned locally'}</>}</p>
    {phase==='planning'&&<p className="command-progress" role="status">Planning locally… <button className="text-action" onClick={dismiss}>Cancel</button></p>}
    {preview&&<div className="command-review"><div className="command-review-heading"><h2>Review changes</h2><span>{preview.changes.length} {preview.changes.length===1?'change':'changes'}</span></div><ul>{preview.changes.map((change,index)=><li key={`${change.id}:${change.field??change.operation}:${index}`}><p>{change.label}</p>{change.operation==='set'?<dl><dt>From</dt><dd>{change.beforeText}</dd><dt>To</dt><dd>{change.afterText}</dd></dl>:<p className="command-change-detail">{change.operation==='tombstone'?change.beforeText:change.afterText}</p>}</li>)}</ul><p className="command-provenance">From your request. Nothing changes until you apply.</p><div className="command-review-actions"><button className="primary-button" disabled={busy} onClick={()=>{void approve();}}>{phase==='applying'?'Applying…':'Apply changes'}</button><button className="text-action" disabled={busy} onClick={dismiss}>Dismiss</button></div></div>}
    {applied&&<p ref={status} tabIndex={-1} role="status" className="command-result">{applied.count} {applied.count===1?'change':'changes'} applied. <button className="text-action" disabled={busy} onClick={()=>{void undoCommand();}}>Undo command</button></p>}
    {error&&<p className="command-error" role="alert">{error}</p>}
  </section>;
}
