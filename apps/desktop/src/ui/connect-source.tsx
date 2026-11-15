import { useEffect, useState } from 'react';
import type { AdministrationArgs, AdministrationName, AdministrationResults, GmailSettingsStatus } from '@fulcrum/domain';
import { Mark } from './fulcrum-activity.js';

type Administer = <N extends AdministrationName>(name: N, args: AdministrationArgs[N]) => Promise<AdministrationResults[N]>;
type Setup = AdministrationResults['workspace.setupStatus'];
interface Props { administer: Administer; pollMs?: number }

const DEFAULT_POLL_MS = 1000;
const ERROR = 'That did not work. Try again.';
const COMING_SOON = ['Slack', 'Google Drive', 'Granola'];

export function ConnectSource({ administer, pollMs = DEFAULT_POLL_MS }: Props) {
  const [gmail, setGmail] = useState<GmailSettingsStatus>();
  const [setup, setSetup] = useState<Setup>();
  const [chosen, setChosen] = useState(false);
  const [account, setAccount] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [handover, setHandover] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const [status, workspace] = await Promise.all([administer('gmail.status', {}), administer('workspace.setupStatus', {})]);
        if (!mounted) return;
        setGmail(status); setSetup(workspace);
        if (status.phase === 'connecting') timer = setTimeout(() => { void refresh(); }, pollMs);
      } catch { if (mounted) setError(ERROR); }
    }
    void refresh();
    return () => { mounted = false; clearTimeout(timer); };
  }, [administer, attempt, pollMs]);

  async function perform(operation: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await operation(); }
    catch { setError(ERROR); }
    finally { setBusy(false); setAttempt(value => value + 1); }
  }

  const designated = !!setup && setup.ingestionDeviceId === setup.deviceId;
  const readsElsewhere = !!setup && setup.ingestionDeviceId !== null && !designated;

  const body = () => {
    if (error && !gmail) return <><p role="alert">{error}</p><button className="primary-button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Try again</button></>;
    if (!gmail || !setup) return <p role="status">Loading…</p>;
    if (gmail.phase === 'active') return <>
      <Mark working />
      <h2>Fulcrum is reading {gmail.label.label}</h2>
      <p>It will propose initiatives and ask you only what it needs. Nothing becomes active until you approve it.</p>
      <a className="primary-button" href="#initiatives">Go to Initiatives</a>
    </>;
    if (gmail.phase === 'select') return <form onSubmit={event => { event.preventDefault(); void perform(() => administer('gmail.select', { id: label })); }}>
      <h2>Which label should Fulcrum read?</h2>
      <p>Signed in as {gmail.account}. Fulcrum reads only the one label you choose.</p>
      {gmail.labels.length ? <fieldset disabled={busy}><legend className="visually-hidden">Gmail label</legend>
        {gmail.labels.map(option => <label key={option.id} className="check-label"><input type="radio" name="label" value={option.id} checked={label === option.id} onChange={() => setLabel(option.id)} />{option.label}</label>)}
      </fieldset> : <p>No labels are available. Create a label in Gmail, then start over.</p>}
      {error && <p role="alert">{error}</p>}
      <button className="primary-button" disabled={busy || !label}>Start reading</button>
      <button type="button" className="link-button" disabled={busy} onClick={() => { setLabel(''); void perform(() => administer('gmail.disconnect', {})); }}>Start over</button>
    </form>;
    if (gmail.phase === 'connecting') return <>
      <Mark working />
      <h2>Finish signing in</h2>
      <p role="status">Finish signing in with Google in your browser. Fulcrum continues when you are done.</p>
      <button className="link-button" disabled={busy} onClick={() => { void perform(() => administer('gmail.disconnect', {})); }}>Cancel sign-in</button>
    </>;
    if (!chosen) return <>
      <h2>Choose a source</h2>
      <p>Fulcrum reads it for you, proposes initiatives and asks only what it needs to know.</p>
      <ul className="source-choices">
        <li><button className="source-choice" onClick={() => setChosen(true)}><strong>Gmail</strong><span>Read mail from one label you pick</span></button></li>
        {COMING_SOON.map(name => <li key={name} className="source-soon"><strong>{name}</strong><span>Coming soon</span></li>)}
      </ul>
    </>;
    if (gmail.phase === 'unavailable') return <><h2>Gmail</h2><p>Gmail is not set up in this build. It needs the native app with a configured Google Desktop OAuth client.</p></>;
    if (!designated) return <form onSubmit={event => {
      event.preventDefault();
      void perform(() => administer('workspace.configure', { deviceLabel: setup.deviceLabel, ingestion: 'this_mac', handoverConfirmed: handover, ...(setup.userEntityId ? { userEntityId: setup.userEntityId } : {}) }));
    }}>
      <h2>Read Gmail on this Mac</h2>
      <p>{readsElsewhere ? 'Another Mac currently reads your sources.' : 'One Mac reads your sources in the background so they are never read twice.'} Credentials stay on the Mac that reads.</p>
      {readsElsewhere && <label className="check-label"><input type="checkbox" checked={handover} disabled={busy} onChange={event => setHandover(event.target.checked)} />I will reconnect credentials here and choose what to read.</label>}
      {error && <p role="alert">{error}</p>}
      <button className="primary-button" disabled={busy || readsElsewhere && !handover}>{readsElsewhere ? 'Move reading to this Mac' : 'Use this Mac to read Gmail'}</button>
    </form>;
    return <form onSubmit={event => { event.preventDefault(); void perform(() => administer('gmail.connect', { account: account.trim(), acknowledged })); }}>
      <h2>Sign in with Google</h2>
      <p>Google grants Fulcrum read access to your mailbox. You pick the one label it reads next.</p>
      {gmail.phase === 'failed' && <p role="alert">Google sign-in did not finish. Try again with the Gmail account you entered.</p>}
      <label>Gmail address<input type="email" required maxLength={254} value={account} disabled={busy} onChange={event => setAccount(event.target.value)} /></label>
      <label className="check-label"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />I understand what Gmail access allows.</label>
      {error && <p role="alert">{error}</p>}
      <button className="primary-button" disabled={busy || !account.trim() || !acknowledged}>Continue with Google</button>
    </form>;
  };

  return <section className="connect-source" aria-label="Connect a source"><h1>Connect a source</h1>{body()}</section>;
}
