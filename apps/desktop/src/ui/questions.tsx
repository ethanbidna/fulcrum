import { useEffect, useRef, useState } from 'react';
import type { InspectionTarget, PortfolioBoard, QuestionReview, QuestionReviewScope } from '@fulcrum/domain';
import type { CoreTransport } from '../core-transport.js';
import { useInitiative } from './use-initiative.js';
import type { ExecuteCommand } from './new-initiative.js';

type QuestionState = NonNullable<QuestionReviewScope['state']>;
interface QuestionProps { board: PortfolioBoard; query: CoreTransport['query']; execute: ExecuteCommand; initiativeId?: string }
const stateLabels: Record<QuestionState, string> = { open: 'Open questions', deferred: 'Deferred', resolved: 'Answered', obsolete: 'No longer needed' };
const emptyLabels: Record<QuestionState, string> = { open: 'No open questions.', deferred: 'No deferred questions.', resolved: 'No answered questions.', obsolete: 'No obsolete questions.' };
const DEFER_DAYS = { tomorrow: 1, nextWeek: 7 };
function deferredUntil(days: number): string {
  const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString();
}
function dateText(value: string): string { return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
function useQuestionReview(props: QuestionProps, state: QuestionState, target?: InspectionTarget) {
  const [entries, setEntries] = useState<QuestionReview[]>(); const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  const scope = JSON.stringify({ ...(props.initiativeId ? { initiativeId: props.initiativeId } : {}), ...(target ? { target } : {}), state });
  const [loadedScope, setLoadedScope] = useState('');
  useEffect(() => {
    let disposed = false; setError('');
    void props.query('questions.review', JSON.parse(scope) as QuestionReviewScope).then(value => {
      if (!disposed) { setEntries(value); setLoadedScope(scope); }
    }).catch(() => { if (!disposed) { setEntries(undefined); setLoadedScope(scope); setError('Could not load questions. Check the local core connection and retry.'); } });
    return () => { disposed = true; };
  }, [props.query, props.board, scope, revision]);
  return { entries: loadedScope === scope ? entries : undefined, error, refresh: () => setRevision(value => value + 1) };
}
export function QuestionsCenter(props: QuestionProps) {
  const [state, setState] = useState<QuestionState>('open');
  const review = useQuestionReview(props, state);
  const { initiative, loading } = useInitiative(props.initiativeId, props.board, props.query);
  return <section className="questions-center" aria-label="Questions Center">
    <div className="questions-toolbar">{props.initiativeId ? <a href="#questions">All questions</a> : <p>Review a choice when you’re ready. Deferred questions stay out of the open list.</p>}
      <label>Show questions<select value={state} onChange={event => setState(event.target.value as QuestionState)}>{Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {props.initiativeId && <p className="question-scope">{initiative ? <>Questions for <a href={`#initiatives/${initiative.id}`}>{initiative.title}</a></> : loading ? 'Loading initiative…' : 'This initiative is unavailable. Return to all questions or choose another initiative.'}</p>}
    <QuestionReadState {...review} state={state} />
    {review.entries && <QuestionCollection entries={review.entries} execute={props.execute} refresh={review.refresh} grouping="initiative" />}
  </section>;
}
export function ContextualQuestions(props: QuestionProps & { target: InspectionTarget; mode?: 'read' | 'answer' }) {
  const review = useQuestionReview(props, 'open', props.target);
  return <section className="inspector-section contextual-questions" aria-label="Contextual questions"><h3>Questions</h3>
    <QuestionReadState {...review} state="open" />
    {review.entries && <QuestionCollection entries={review.entries} execute={props.execute} refresh={review.refresh} grouping="none" mode={props.mode ?? 'answer'} />}
    <a className="context-questions-link" href={`#questions/${props.initiativeId}`}>All questions for this initiative</a>
  </section>;
}
function QuestionReadState({ entries, error, refresh, state }: { entries: QuestionReview[] | undefined; error: string; refresh: () => void; state: QuestionState }) {
  if (error) return <div className="question-read-error"><p className="command-error" role="alert">{error}</p><button className="secondary-button" onClick={refresh}>Retry questions</button></div>;
  if (!entries) return <p role="status">Loading questions…</p>;
  if (!entries.length) return <p className="questions-empty">{emptyLabels[state]}</p>;
  return null;
}
interface ActionState { busy: boolean; error: string; saved?: { eventId?: string; label: string }; run: (command: Parameters<ExecuteCommand>[0], label: string) => Promise<void> }
function useQuestionActions(execute: ExecuteCommand, refresh: () => void): ActionState {
  const active = useRef(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ eventId?: string; label: string }>();
  const run = async (command: Parameters<ExecuteCommand>[0], label: string) => {
    if (active.current) return;
    active.current = true; setBusy(true); setError(''); setSaved(undefined);
    try {
      const result = await execute(command);
      if (!result.ok) { setError(result.error.message); return; }
      setSaved(command.name === 'change.undo' ? { label } : { eventId: result.eventId, label }); refresh();
    } catch { setError('Could not save your choice. Check the local core connection and try again.'); }
    finally { active.current = false; setBusy(false); }
  };
  return { busy, error, ...(saved ? { saved } : {}), run };
}
function QuestionCollection({ entries, execute, refresh, grouping, mode = 'answer' }: { mode?: 'read' | 'answer'; entries: QuestionReview[]; execute: ExecuteCommand; refresh: () => void; grouping: 'initiative' | 'none' }) {
  const actions = useQuestionActions(execute, refresh);
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (actions.saved || actions.error) feedback.current?.focus(); }, [actions.saved, actions.error]);
  const groups = new Map<string, QuestionReview[]>();
  for (const entry of entries) { const key = grouping === 'initiative' ? entry.initiative.id : 'context'; groups.set(key, [...(groups.get(key) ?? []), entry]); }
  return <div className="question-collection">
    {actions.error && <p ref={feedback} tabIndex={-1} className="command-error" role="alert">{actions.error}</p>}
    {actions.saved && <p ref={feedback} tabIndex={-1} className="question-saved" role="status">{actions.saved.label} {actions.saved.eventId && <button className="text-action" disabled={actions.busy} onClick={() => { void actions.run({ name: 'change.undo', args: { eventId: actions.saved!.eventId! } }, 'Change undone.'); }}>Undo</button>}</p>}
    {[...groups].map(([key, group]) => <section key={key} className="question-group" aria-label={grouping === 'initiative' ? group[0]!.initiative.title : 'Questions on this object'}>
      {grouping === 'initiative' && <h2><a href={`#questions/${key}`}>{group[0]!.initiative.title}</a><span aria-hidden="true">{group.length}</span></h2>}
      {group.map(entry => <QuestionRow key={entry.question.id} entry={entry} actions={actions} mode={mode} />)}
    </section>)}
  </div>;
}
function QuestionRow({ entry, actions, mode }: { entry: QuestionReview; actions: ActionState; mode: 'read' | 'answer' }) {
  const { question } = entry; const live = mode === 'answer' && (question.state === 'open' || question.state === 'deferred');
  return <article className="question-row" aria-label={question.prompt} aria-busy={actions.busy}>
    <div className="question-context"><p>{entry.context.label}</p><a href={entry.context.href}>View context</a></div>
    <h3>{question.prompt}</h3>
    {question.state === 'deferred' && <p className="question-state">{question.deferredUntil ? `Deferred until ${dateText(question.deferredUntil)}` : 'Deferred until you return'}</p>}
    {question.state === 'resolved' && <p className="question-state">Answered: {question.resolutions.find(choice => choice.id === question.resolvedWith)?.label ?? 'Recorded choice'}</p>}
    {question.state === 'obsolete' && <p className="question-state">No longer needs a choice.</p>}
    <details className="question-evidence"><summary>Evidence · {entry.evidence.length}</summary>{entry.evidence.length ? <ul>{entry.evidence.map((source, index) => <li key={`${source.id}:${index}`}>
      {source.permalink ? <a href={source.permalink} target="_blank" rel="noreferrer">{source.title}<span className="visually-hidden"> (opens original in a new window)</span></a> : <span>{source.title} · no original link</span>}
      <p>{source.connector}{source.happenedAt ? <> · Happened <time dateTime={source.happenedAt}>{dateText(source.happenedAt)}</time></> : ' · Event time unavailable'}</p>
      <p>Learned <time dateTime={source.ingestedAt}>{dateText(source.ingestedAt)}</time></p>
      {source.excerpt && <blockquote>{source.excerpt}</blockquote>}
    </li>)}</ul> : <p>Recorded from workspace changes; no source evidence is attached.</p>}</details>
    {live && <div className="question-actions">{question.resolutions.map(choice => <button key={choice.id} className="secondary-button" disabled={actions.busy} onClick={() => { void actions.run({ name: 'question.resolve', args: { id: question.id, resolutionId: choice.id } }, 'Answer saved.'); }}>{choice.label}</button>)}
      <details className="question-defer"><summary>Defer</summary><div><button className="text-action" disabled={actions.busy} onClick={() => { void actions.run({ name: 'question.defer', args: { id: question.id, deferredUntil: deferredUntil(DEFER_DAYS.tomorrow) } }, 'Question deferred.'); }}>Tomorrow</button><button className="text-action" disabled={actions.busy} onClick={() => { void actions.run({ name: 'question.defer', args: { id: question.id, deferredUntil: deferredUntil(DEFER_DAYS.nextWeek) } }, 'Question deferred.'); }}>Next week</button><button className="text-action" disabled={actions.busy} onClick={() => { void actions.run({ name: 'question.defer', args: { id: question.id, deferredUntil: null } }, 'Question deferred.'); }}>Until I return</button></div></details>
    </div>}
  </article>;
}
