import { useEffect, useRef, useState } from 'react';
import type { AdministrationArgs, AdministrationName, AdministrationResults, ConnectionRuntimeStatus } from '@fulcrum/domain';

type Administer = <N extends AdministrationName>(name: N, args: AdministrationArgs[N]) => Promise<AdministrationResults[N]>;
interface Props { administer: Administer; designated: boolean; pollMs?: number; onPhaseChange?(phase: ConnectionRuntimeStatus['phase']): void }
const POLL_MS = 1000;
const MEBIBYTE = 1024 ** 2;
const BUSY_PHASES = new Set(['checking', 'installing', 'starting', 'stopping']);
export function ConnectionRuntimeControls({ administer, designated, pollMs = POLL_MS, onPhaseChange }: Props) {
  const [status, setStatus] = useState<ConnectionRuntimeStatus>();
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [sending, setSending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const lastPhase = useRef<ConnectionRuntimeStatus['phase'] | undefined>(undefined);
  const startButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => { if (refocus.current && startButton.current) { startButton.current.focus(); refocus.current = false; } }, [status?.phase]);
  useEffect(() => {
    let mounted = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const next = await administer('sources.runtime.status', {});
        if (!next || typeof next.phase !== 'string' || typeof next.installed !== 'boolean') throw new Error('invalid_runtime_status');
        if (!mounted) return;
        setStatus(next);
        if (next.phase !== lastPhase.current) {
          lastPhase.current = next.phase; onPhaseChange?.(next.phase);
        }
        timer = setTimeout(() => { void read(); }, pollMs);
      } catch { if (mounted) { setError('Could not check the connection service. Retry to refresh its status.'); setStatus(undefined); } }
    };
    void read(); return () => { mounted = false; clearTimeout(timer); };
  }, [administer, pollMs, refresh, onPhaseChange]);
  async function action(name: 'sources.runtime.start' | 'sources.runtime.stop') {
    if (sending) return;
    setSending(true); setError('');
    if (name === 'sources.runtime.stop') refocus.current = true;
    try {
      if (name === 'sources.runtime.start') await administer(name, { acknowledged: true });
      else await administer(name, {});
      setAcknowledged(false);
    } catch { setError('Could not update the connection service. Check its status and retry.'); }
    finally { setSending(false); setRefresh(value => value + 1); }
  }
  const busy = !!status && BUSY_PHASES.has(status.phase);
  const canStart = status && ['not_installed', 'stopped', 'failed'].includes(status.phase);
  const installing = canStart && !status.installed;
  return <section className="managed-sources" aria-label="Local connection service">
    <h3>Local connection service</h3>
    <p>Fulcrum runs Activepieces on this Mac to save connections for your tools. Its dashboard does not open.</p>
    {status ? <p role={status.phase === 'failed' ? 'alert' : 'status'}>{status.message}</p> : !error && <p role="status">Checking the connection service…</p>}
    {status?.completedBytes !== null && status?.completedBytes !== undefined && <p>{Math.floor(status.completedBytes / MEBIBYTE)} MiB downloaded{status.totalBytes ? ` of ${Math.ceil(status.totalBytes / MEBIBYTE)} MiB` : ''}</p>}
    {installing && <><p>Setup downloads several gigabytes. The isolated service reserves 4 GiB of memory and 2 CPUs, plus a small host process. Its virtual disk can grow to 20 GiB. Installation requires 24 GiB free. Your workspace folders are not mounted in the service.</p>
      <label className="check-label"><input type="checkbox" checked={acknowledged} disabled={!designated || sending} onChange={event => setAcknowledged(event.target.checked)} />I agree to download and run the local connection service.</label></>}
    {canStart && <button ref={startButton} className="secondary-button" disabled={!designated || sending || !!installing && !acknowledged} onClick={() => { void action('sources.runtime.start'); }}>{installing ? 'Download and set up connections' : 'Start connection service'}</button>}
    {status && (busy && status.phase !== 'checking' || status.phase === 'ready' || status.phase === 'failed' && status.installed) && <button className="secondary-button" disabled={sending || status.phase === 'stopping'} onClick={() => { void action('sources.runtime.stop'); }}>{status.phase === 'installing' || status.phase === 'starting' ? 'Cancel connection service setup' : 'Stop connection service'}</button>}
    {canStart && !designated && <p>Use the designated ingestion Mac, or move source connections to this Mac in Workspace settings.</p>}
    {status?.phase === 'ready' && <p>Stopping keeps saved connections. The service starts again with Fulcrum only while enabled on the designated Mac.</p>}
    {error && <><p role="alert">{error}</p><button className="secondary-button" onClick={() => { setError(''); setRefresh(value => value + 1); }}>Retry connection service status</button></>}
  </section>;
}
