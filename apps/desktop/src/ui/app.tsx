import { Settings } from './settings.js';
import { Priorities } from './priorities.js';
import { Timeline, useTimeline } from './timeline.js';
import { EvidencePanel } from './evidence.js';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { InspectionTarget } from '@fulcrum/domain';
import type { Platform } from '../platform/platform.js';
import { destinationFromHash, initiativeFromHash, focusedNodeFromHash, initiativeViewFromHash, questionInitiativeFromHash, inspectionFromHash, destinations } from './navigation.js';
import type { Destination } from './navigation.js';
import { useInitiative } from './use-initiative.js';
import { useCore } from './use-core.js';
import type { CoreState } from './use-core.js';
import { CommandBar } from './command-bar.js';
import { ListView, HistoryView } from './detail-views.js';
import { QuestionsCenter } from './questions.js';
import { Portfolio } from './portfolio.js';
import { Icon } from './icon.js';
const FlowCanvas = lazy(async () => ({ default: (await import('./flow-canvas.js')).FlowCanvas }));
const mark = new URL('../../../../assets/fulcrum-mark.svg', import.meta.url).href;
const descriptions: Record<Destination, string> = {
  initiatives: 'Your work, organized around outcomes.',
  priorities: 'What matters, in the order you choose.',
  questions: 'Clarifications, kept with their context.',
  settings: 'Your workspace and local preferences.',
};
function Connection({ state, retry }: { state: CoreState; retry: () => void }) {
  const text = state.phase === 'connected' ? 'Connected to local core' : state.phase === 'connecting' ? 'Connecting to local core…' : 'Local core unavailable';
  return <div className="connection"><p role="status"><span className={`connection-dot ${state.phase}`} aria-hidden="true" />{text}</p>{state.phase === 'unavailable' && <button onClick={retry}>Retry connection</button>}</div>;
}
export function App({ platform }: { platform: Platform }) {
  const [destination, setDestination] = useState(() => destinationFromHash(window.location.hash));
  const [initiativeId, setInitiativeId] = useState(() => initiativeFromHash(window.location.hash));
  const [focusedNodeId, setFocusedNodeId] = useState(() => focusedNodeFromHash(window.location.hash));
  const [detailView,setDetailView] = useState(()=>initiativeViewFromHash(window.location.hash));
  const [questionInitiativeId, setQuestionInitiativeId] = useState(() => questionInitiativeFromHash(window.location.hash));
  const [initialInspection, setInitialInspection] = useState(() => inspectionFromHash(window.location.hash));
  const [commandTarget,setCommandTarget] = useState<InspectionTarget>();
  useEffect(()=>{setCommandTarget(initialInspection ?? (focusedNodeId ? {kind:'node',id:focusedNodeId} : undefined));},[initiativeId,focusedNodeId,detailView,initialInspection?.kind,initialInspection?.id,destination,questionInitiativeId]);
  const heading = useRef<HTMLHeadingElement>(null);
  const { state, retry, execute, query, administer, undo, canUndo, planCommand, cancelCommandPlan, applyCommandPlan } = useCore(platform);
  useEffect(() => {
    const navigate = () => { setDestination(destinationFromHash(window.location.hash)); setInitiativeId(initiativeFromHash(window.location.hash)); setFocusedNodeId(focusedNodeFromHash(window.location.hash)); setDetailView(initiativeViewFromHash(window.location.hash)); setQuestionInitiativeId(questionInitiativeFromHash(window.location.hash)); setInitialInspection(inspectionFromHash(window.location.hash)); };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const { initiative, loading: initiativeLoading } = useInitiative(initiativeId, state.phase === 'connected' ? state.board : undefined, query);
  useEffect(() => { document.title = `${initiative?.title ?? destinations.find(item => item.id === destination)!.label} · Fulcrum`; heading.current?.focus(); }, [destination, initiative?.title, questionInitiativeId, initialInspection?.id]);
  const timeline = useTimeline(initiativeId, state.phase === 'connected' ? state.board : undefined, query);
  const page = destinations.find(item => item.id === destination)!;
  const activeInitiativeId = initiativeId ?? questionInitiativeId;
  const requestTarget: InspectionTarget | undefined = commandTarget
    ?? (focusedNodeId ? {kind:'node',id:focusedNodeId}
      : activeInitiativeId ? {kind:'initiative',id:activeInitiativeId} : undefined);
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); heading.current?.focus(); }}>Skip to content</a>
    <aside className="sidebar" aria-label="Workspace">
      <div className="brand"><img src={mark} width="28" height="28" alt="" /><span>Fulcrum</span></div>
      <nav aria-label="Main navigation">{destinations.map(item => <a key={item.id} className={`navigation-link ${item.id === 'settings' ? 'settings-link' : ''}`} href={`#${item.id}`} aria-current={destination === item.id ? 'page' : undefined}>
        <Icon name={item.id} /><span>{item.label}</span>
        {item.id === 'questions' && state.phase === 'connected' && state.questionCount > 0 && <span className="question-count" aria-label={`${state.questionCount} open questions`}>{state.questionCount}</span>}
      </a>)}</nav>
      <Connection state={state} retry={retry} />
    </aside>
    <main id="main-content">
      <header className="page-header">{initiativeId && destination === 'initiatives' && <a className="breadcrumb" href="#initiatives">Initiatives</a>}<h1 ref={heading} tabIndex={-1}>{initiative?.title ?? page.label}</h1>{!initiativeId && <p>{descriptions[destination]}</p>}</header>
      {<CommandBar available={state.phase === 'connected'} {...(requestTarget ? {target:requestTarget} : {})} {...(activeInitiativeId ? {initiativeId:activeInitiativeId} : {})} plan={planCommand} apply={applyCommandPlan} cancel={cancelCommandPlan} undo={eventId=>execute({name:'change.undo',args:{eventId}})} />}
      {initiativeId && initiative && <a className="initiative-questions-link" href={`#questions/${initiativeId}`}>Questions for this initiative</a>}
      {initiativeId && initiative && <nav className="initiative-views" aria-label="Initiative views">{(['flow','list','context','timeline','history'] as const).filter(view=>view!=='timeline'||!!timeline?.value?.items?.length).map(view=><a key={view} aria-current={detailView===view?'page':undefined} href={`#initiatives/${initiativeId}${view==='flow'?'':`/${view}`}`}>{view[0]!.toUpperCase()+view.slice(1)}</a>)}</nav>}
      {state.phase === 'unavailable' ? <section className="view-message" aria-labelledby="connection-heading"><Icon name={destination} /><h2 id="connection-heading">Connect to your workspace</h2><p>Open the local core, then retry the connection.</p><button className="primary-button" onClick={retry}>Retry connection</button></section>
        : state.phase === 'connecting' ? <section className="view-message" aria-busy="true"><div className="loading-lines" aria-hidden="true"><span /><span /></div><p>Opening your workspace…</p></section>
          : destination === 'initiatives' && initiativeId ? initiative ? detailView==='timeline' ? timeline?.error ? <p role="alert">{timeline.error}</p> : timeline?.value ? <Timeline value={timeline.value}/> : <p role="status">Loading target dates…</p> : detailView==='context' ? <EvidencePanel key={initiativeId} scope={{initiativeId}} board={state.board} query={query} /> : detailView==='list' ? <ListView key={initiativeId} initiativeId={initiativeId} board={state.board} query={query} execute={execute} onInspectionChange={setCommandTarget}/> : detailView==='history' ? <HistoryView key={initiativeId} initiativeId={initiativeId} board={state.board} query={query} execute={execute} onInspectionChange={setCommandTarget}/> : <Suspense fallback={<p role="status">Opening the flow editor…</p>}><FlowCanvas onInspectionChange={setCommandTarget} key={`${initiativeId}:${focusedNodeId ?? initialInspection?.id ?? 'full'}`} {...(initialInspection ? { initialTarget: initialInspection } : {})} {...(focusedNodeId ? { focusedNodeId } : {})} initiative={initiative} board={state.board} query={query} execute={execute} undo={undo} canUndo={canUndo} /></Suspense> : initiativeLoading ? <p role="status">Opening the initiative…</p> : <section className="view-message"><h2>Initiative unavailable</h2><p>It may have been archived or removed.</p><a href="#initiatives">Return to initiatives</a></section> : destination === 'initiatives' ? <Portfolio board={state.board} execute={execute} /> : destination === 'settings' ? <Settings administer={administer} query={query} execute={execute} /> : destination === 'priorities' ? <Priorities board={state.board} query={query} execute={execute} /> : destination === 'questions' ? <QuestionsCenter key={questionInitiativeId ?? 'all'} board={state.board} query={query} execute={execute} {...(questionInitiativeId ? { initiativeId: questionInitiativeId } : {})} /> : <section className="view-message"><h2>Destination unavailable</h2></section>}
    </main>
  </div>;
}
