import { useEffect, useRef, useState } from 'react';
import type { AdministrationArgs, AdministrationName, AdministrationResults, ManagedSourceId, ManagedSourceStatus } from '@fulcrum/domain';

type Administer = <N extends AdministrationName>(name: N, args: AdministrationArgs[N]) => Promise<AdministrationResults[N]>;
interface Props { administer: Administer; designated: boolean; pollMs?: number }
const POLL_MS = 1000;
const MAX_API_KEY_LENGTH = 4096;
const SOURCES: { id: ManagedSourceId; name: string; permission: string }[] = [
  { id: 'gmail', name: 'Gmail', permission: 'Google grants read access to your mailbox.' },
  { id: 'slack', name: 'Slack', permission: 'Request read access to public channels available to the app. Private channels and direct messages are not requested.' },
  { id: 'granola', name: 'Granola', permission: 'Use a supported Granola API key. Your account may require an eligible plan or administrator approval.' },
  { id: 'google_drive', name: 'Google Drive', permission: 'Google grants read access to your Drive files.' },
  { id: 'dropbox', name: 'Dropbox', permission: 'Dropbox grants read access to files and folders available to the connection.' },
  { id: 'google_calendar', name: 'Google Calendar', permission: 'Google grants read access to your calendars.' },
];
const PHASE_TEXT: Record<ManagedSourceStatus['phase'], string> = {
  unavailable: 'Connection service unavailable on this Mac.', disconnected: 'Not connected.',
  connecting: 'Finish connecting in your browser, or wait for your key to be checked.', saved: 'Saved on this Mac; not checked since restart.',
  connected: 'Connection saved. Importing is off.', failed: 'Connection did not finish. Try connecting again.', cancelling: 'Cancelling the connection…',
};
type Operation = 'connect' | 'check' | 'disconnect';

export function ManagedSources({ administer, designated, pollMs = POLL_MS }: Props) {
  const [statuses, setStatuses] = useState<ManagedSourceStatus[]>();
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState<ManagedSourceId>();
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState<Map<ManagedSourceId, Operation>>(new Map());
  const connectButtons = useRef(new Map<ManagedSourceId, HTMLButtonElement>());
  const active = useRef(new Map<ManagedSourceId, Operation>());
  const [cancelling, setCancelling] = useState<Set<ManagedSourceId>>(new Set());

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const next = await administer('sources.status', {});
        if (!Array.isArray(next)) throw new Error('Invalid source status');
        if (!mounted) return;
        setStatuses(next); setLoadError(false);
        if (pending.size || next.some(status => status.phase === 'connecting' || status.phase === 'cancelling')) timer = setTimeout(() => { void read(); }, pollMs);
      } catch { if (mounted) { setStatuses(undefined); setLoadError(true); } }
    };
    void read();
    return () => { mounted = false; clearTimeout(timer); };
  }, [administer, refresh, pollMs, pending]);

  async function perform(source: ManagedSourceId, operation: Operation, request: () => Promise<unknown>) {
    if (active.current.has(source)) return;
    active.current.set(source, operation); setPending(new Map(active.current)); setActionError('');
    try { await request(); }
    catch { setActionError('The connection could not be updated. Retry, or check the local connection service.'); }
    finally { active.current.delete(source); setPending(new Map(active.current)); setRefresh(value => value + 1); }
  }
  async function cancel(source: ManagedSourceId) {
    setCancelling(value => new Set(value).add(source)); setActionError('');
    try { await administer('sources.cancel', { source }); }
    catch { setActionError('Cancellation could not finish. Check the connection and try again.'); }
    finally { setCancelling(value => { const next = new Set(value); next.delete(source); return next; }); setRefresh(value => value + 1); }
  }

  return <section className="managed-sources" aria-label="Managed source connections">
    <p>Save connections on this Mac. Importing and choosing labels, channels, folders or calendars are not enabled in this preview.</p>
    {!designated && <p>Designate this Mac for ingestion in Workspace settings before connecting a source. You can still check or disconnect saved connections here.</p>}
    {loadError ? <><p role="alert">Could not load source connections.</p><button className="secondary-button" onClick={() => setRefresh(value => value + 1)}>Retry source connections</button></>
      : !statuses ? <p role="status">Loading source connections…</p> : <ul className="managed-source-list">{SOURCES.map(source => {
        const phase = statuses.find(status => status.source === source.id)?.phase ?? 'unavailable';
        const busy = pending.has(source.id);
        const connecting = phase === 'connecting' || pending.get(source.id) === 'connect';
        return <li key={source.id}>
          <section aria-label={`${source.name} managed connection`}>
            <div className="managed-source-row"><div><h3>{source.name}</h3><p role={phase === 'failed' ? 'alert' : undefined} aria-live="polite">{PHASE_TEXT[phase]}</p></div>
              <div className="managed-source-actions">
                {connecting || phase === 'cancelling' ? <button className="secondary-button" disabled={cancelling.has(source.id) || phase === 'cancelling'} onClick={() => { void cancel(source.id); }}>Cancel {source.name} connection</button>
                  : phase !== 'unavailable' && <>
                    {(phase === 'disconnected' || phase === 'failed') && <button ref={element => { if (element) connectButtons.current.set(source.id, element); else connectButtons.current.delete(source.id); }} className="secondary-button" disabled={!designated || busy} onClick={() => { setEditing(source.id); setActionError(''); }}>Connect {source.name}</button>}
                    {(phase === 'saved' || phase === 'connected') && <button className="secondary-button" disabled={busy} onClick={() => { void perform(source.id, 'check', () => administer('sources.verify', { source: source.id })); }}>Check {source.name} connection</button>}
                    {(phase === 'saved' || phase === 'connected' || phase === 'failed') && <button className="secondary-button" disabled={busy} onClick={() => { setEditing(undefined); void perform(source.id, 'disconnect', () => administer('sources.disconnect', { source: source.id })); }}>Disconnect {source.name}</button>}
                  </>}
              </div>
            </div>
            {busy && <p role="status">Updating {source.name} connection…</p>}
            {editing === source.id && !connecting && <SourceConnectionForm key={source.id} source={source} disabled={!designated || busy}
              cancel={() => { setEditing(undefined); connectButtons.current.get(source.id)?.focus(); }} connect={apiKey => {
                setEditing(undefined);
                void perform(source.id, 'connect', () => source.id === 'granola'
                  ? administer('sources.granola', { apiKey: apiKey ?? '', acknowledged: true })
                  : administer('sources.connect', { source: source.id, acknowledged: true }));
              }} />}
          </section>
        </li>;
      })}</ul>}
    {actionError && <p role="alert">{actionError}</p>}
  </section>;
}

function SourceConnectionForm({ source, disabled, connect, cancel }: {
  source: typeof SOURCES[number]; disabled: boolean; connect(apiKey?: string): void; cancel(): void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const granola = source.id === 'granola';
  return <form className="managed-source-form" aria-label={`Connect ${source.name}`} onSubmit={event => {
    event.preventDefault();
    if (disabled || !acknowledged || granola && !apiKey.trim()) return;
    const key = apiKey; setApiKey(''); connect(granola ? key : undefined);
  }}>
    <p>{source.permission} Connecting does not start importing.</p>
    <p>{granola ? 'Activepieces stores this key in its encrypted local connection store.' : 'Activepieces handles authorization-code exchange and renewal. Source credentials are stored in its encrypted local connection store.'}</p>
    {granola && <label>Granola API key<input type="password" maxLength={MAX_API_KEY_LENGTH} autoComplete="off" value={apiKey} disabled={disabled} onChange={event => setApiKey(event.target.value)} /></label>}
    <label className="check-label"><input type="checkbox" checked={acknowledged} disabled={disabled} onChange={event => setAcknowledged(event.target.checked)} />I agree to connect {source.name} through Activepieces.</label>
    <div className="managed-source-actions"><button className="secondary-button" disabled={disabled || !acknowledged || granola && !apiKey.trim()}>{granola ? 'Save Granola connection' : `Continue to ${source.name} in browser`}</button>
      <button type="button" className="secondary-button" onClick={cancel}>Cancel setup</button></div>
  </form>;
}
