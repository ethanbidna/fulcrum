import { useEffect, useState } from 'react';
import type { AdministrationArgs, AdministrationName, AdministrationResults, GmailSettingsStatus } from '@fulcrum/domain';

type Administer = <N extends AdministrationName>(name: N, args: AdministrationArgs[N]) => Promise<AdministrationResults[N]>;
const POLL_MS = 1000;
const ERROR = 'Gmail settings could not be updated. Try again.';

export function GmailSettings({ administer, designated, mode = 'all' }: { administer: Administer; designated: boolean; mode?: 'all' | 'existing' }) {
  const [status, setStatus] = useState<GmailSettingsStatus>();
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const next = await administer('gmail.status', {});
        if (!mounted) return;
        setStatus(next);
        if (next.phase === 'connecting') timer = setTimeout(() => { void refresh(); }, POLL_MS);
      } catch { if (mounted) setError(ERROR); }
    }
    void refresh();
    return () => { mounted = false; clearTimeout(timer); };
  }, [administer, attempt]);

  async function perform(operation: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try { await operation(); }
    catch { setError(ERROR); }
    finally { setBusy(false); setAttempt(value => value + 1); }
  }

  if (mode === 'existing' && (!status || !['select', 'active', 'connecting'].includes(status.phase))) return null;
  return <section aria-label="Gmail">
    <h3>{mode === 'existing' ? 'Existing Gmail connection' : 'Gmail'}</h3>
    {error && <><p role="alert">{error}</p><button className="secondary-button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry Gmail settings</button></>}
    {!status && !error && <p role="status">Loading Gmail settings…</p>}
    {status?.phase === 'unavailable' && <p>Gmail setup is unavailable for this workspace. Use the native app with a configured Google Desktop OAuth client.</p>}
    {status?.phase === 'connecting' && <p role="status">Finish signing in with Google in your browser.</p>}
    {(status?.phase === 'disconnected' || status?.phase === 'failed') && <>
      {status.phase === 'failed' && <p role="alert">Google sign-in did not finish. Try again.</p>}
      {designated ? <form onSubmit={event => {
        event.preventDefault();
        void perform(() => administer('gmail.connect', { acknowledged: true }));
      }}>
        <p>Google grants read access to your mailbox. Fulcrum reads messages only from the label you choose after signing in.</p>
        <button className="secondary-button" disabled={busy}>Sign in with Google</button>
      </form> : <p>Designate this Mac for ingestion in Workspace settings to connect Gmail.</p>}
    </>}
    {status?.phase === 'select' && <form onSubmit={event => {
      event.preventDefault();
      void perform(() => administer('gmail.select', { id: label }));
    }}>
      <p>Signed in as {status.account}.</p>
      {status.labels.length ? <>
        <label>Gmail label<select value={label} disabled={busy || !designated} onChange={event => setLabel(event.target.value)}>
          <option value="">Choose a label</option>
          {status.labels.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select></label>
        <button className="secondary-button" disabled={busy || !designated || !label}>Start sync</button>
      </> : <p>No labels are available. Create a label in Gmail, then disconnect and sign in again.</p>}
    </form>}
    {status?.phase === 'active' && <p role="status">{designated ? 'Sync enabled' : 'Sync paused on this Mac'} for {status.label.label} in {status.account}.</p>}
    {(status?.phase === 'select' || status?.phase === 'active' || status?.phase === 'connecting') &&
      <button className="secondary-button" disabled={busy} onClick={() => {
        setLabel('');
        void perform(() => administer('gmail.disconnect', {}));
      }}>{status.phase === 'connecting' ? 'Cancel Gmail sign-in' : 'Disconnect Gmail'}</button>}
  </section>;
}
