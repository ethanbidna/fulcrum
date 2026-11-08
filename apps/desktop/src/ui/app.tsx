import { useEffect, useRef, useState } from 'react';
import type { Platform } from '../platform/platform.js';
import { destinationFromHash, destinations } from './navigation.js';
import type { Destination } from './navigation.js';
import { useCore } from './use-core.js';
import type { CoreState } from './use-core.js';
import { Icon } from './icon.js';
const mark = new URL('../../../../assets/fulcrum-mark.svg', import.meta.url).href;
const descriptions: Record<Destination, string> = {
  initiatives: 'Your work, organized around outcomes.',
  priorities: 'What matters, in the order you choose.',
  questions: 'Clarifications, kept with their context.',
  settings: 'Your workspace and local preferences.',
};
const unavailableViews: Record<Destination, { title: string; detail: string }> = {
  initiatives: { title: 'Your initiative portfolio', detail: 'The portfolio board is not available in this build.' },
  priorities: { title: 'Make room for what matters', detail: 'Objective ranking and KPIs are not available in this build.' },
  questions: { title: 'Clarity without interruption', detail: 'Contextual question review is not available in this build.' },
  settings: { title: 'A workspace on your terms', detail: 'Workspace and integration settings are not available in this build.' },
};
function Connection({ state, retry }: { state: CoreState; retry: () => void }) {
  const text = state.phase === 'connected' ? 'Connected to local core' : state.phase === 'connecting' ? 'Connecting to local core…' : 'Local core unavailable';
  return <div className="connection"><p role="status"><span className={`connection-dot ${state.phase}`} aria-hidden="true" />{text}</p>{state.phase === 'unavailable' && <button onClick={retry}>Retry connection</button>}</div>;
}
export function App({ platform }: { platform: Platform }) {
  const [destination, setDestination] = useState(() => destinationFromHash(window.location.hash));
  const heading = useRef<HTMLHeadingElement>(null);
  const { state, retry } = useCore(platform);
  useEffect(() => {
    const navigate = () => { setDestination(destinationFromHash(window.location.hash)); };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => { document.title = `${destinations.find(item => item.id === destination)!.label} · Fulcrum`; heading.current?.focus(); }, [destination]);
  const page = destinations.find(item => item.id === destination)!;
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
      <header className="page-header"><h1 ref={heading} tabIndex={-1}>{page.label}</h1><p>{descriptions[destination]}</p></header>
      {state.phase === 'unavailable' ? <section className="view-message" aria-labelledby="connection-heading"><Icon name={destination} /><h2 id="connection-heading">Connect to your workspace</h2><p>Open the local core, then retry the connection.</p><button className="primary-button" onClick={retry}>Retry connection</button></section>
        : state.phase === 'connecting' ? <section className="view-message" aria-busy="true"><div className="loading-lines" aria-hidden="true"><span /><span /></div><p>Opening your workspace…</p></section>
          : <section className="view-message" aria-labelledby="view-heading"><Icon name={destination} /><h2 id="view-heading">{unavailableViews[destination].title}</h2><p>{unavailableViews[destination].detail}</p>{destination === 'initiatives' && <p className="workspace-count">{state.initiativeCount === 0 ? 'No active initiatives in this workspace.' : `${state.initiativeCount} active ${state.initiativeCount === 1 ? 'initiative' : 'initiatives'} in this workspace.`}</p>}</section>}
    </main>
  </div>;
}
