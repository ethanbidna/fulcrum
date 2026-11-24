import { useEffect, useState } from 'react';
import type { AdministrationArgs, AdministrationName, AdministrationResults } from '@fulcrum/domain';
import { SourceConnections } from './source-connections.js';
import { GmailSettings } from './gmail-settings.js';

type Administer = <N extends AdministrationName>(name: N, args: AdministrationArgs[N]) => Promise<AdministrationResults[N]>;
type Setup = AdministrationResults['workspace.setupStatus'];
interface Props { administer: Administer; pollMs?: number }

export function ConnectSource({ administer, pollMs }: Props) {
  const [setup, setSetup] = useState<Setup>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [handover, setHandover] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let mounted = true;
    void administer('workspace.setupStatus', {}).then(value => { if (mounted) { setSetup(value); setError(false); } }).catch(() => { if (mounted) setError(true); });
    return () => { mounted = false; };
  }, [administer, refresh]);
  const designated = setup?.ingestionDeviceId === setup?.deviceId;
  const elsewhere = !!setup?.ingestionDeviceId && !designated;
  async function designate() {
    if (!setup || busy) return;
    setBusy(true); setError(false);
    try {
      await administer('workspace.configure', { deviceLabel: setup.deviceLabel, ingestion: 'this_mac', handoverConfirmed: handover,
        ...(setup.userEntityId ? { userEntityId: setup.userEntityId } : {}) });
      setRefresh(value => value + 1);
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <section className="connect-source" aria-label="Connect a source"><h1>Connect a source</h1>
    {error && <><p role="alert">Source setup could not be loaded or updated.</p><button className="secondary-button" onClick={() => setRefresh(value => value + 1)}>Retry source setup</button></>}
    {!setup ? !error && <p role="status">Loading source setup…</p> : <>
      {!designated && <form onSubmit={event => { event.preventDefault(); void designate(); }}>
        <h2>Connect sources on this Mac</h2><p>{elsewhere ? 'Another Mac is designated for source ingestion.' : 'Choose which Mac will keep your source credentials.'} Moving this designation does not transfer credentials or start importing.</p>
        {elsewhere && <label className="check-label"><input type="checkbox" checked={handover} disabled={busy} onChange={event => setHandover(event.target.checked)} />I will reconnect credentials here and choose what to read.</label>}
        <button className="secondary-button" disabled={busy || elsewhere && !handover}>Use this Mac for source connections</button>
      </form>}
      <h2>Source connections</h2>
      <SourceConnections administer={administer} designated={designated} {...(pollMs === undefined ? {} : { pollMs })} />
      <GmailSettings mode="existing" administer={administer} designated={designated} />
    </>}
  </section>;
}
