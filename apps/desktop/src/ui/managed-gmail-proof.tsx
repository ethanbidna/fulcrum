import { useState } from 'react';

export interface ManagedGmailActions {
  connect(): Promise<{ id: string; name: string }[]>;
  read(labelId: string): Promise<{ messages: number; pages: number }>;
}

export function ManagedGmailProof({ actions }: { actions: ManagedGmailActions }) {
  const [labels, setLabels] = useState<{ id: string; name: string }[]>();
  const [labelId, setLabelId] = useState('');
  const [pending, setPending] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  async function connect() {
    setLabels(undefined);
    setLabelId('');
    setResult('');
    setError('');
    setPending('Finish signing in with Google in the popup.');
    try {
      setLabels(await actions.connect());
    } catch {
      setError('Gmail could not connect. Close the popup and try again.');
    } finally {
      setPending('');
    }
  }

  async function read() {
    setResult('');
    setError('');
    setPending('Reading test messages…');
    try {
      const counts = await actions.read(labelId);
      setResult(`Read ${counts.messages} test messages. No messages were changed.`);
    } catch {
      setError('The test read could not finish. Try again.');
    } finally {
      setPending('');
    }
  }

  return <section className="settings-content" aria-labelledby="managed-gmail-heading">
    <h2 id="managed-gmail-heading">Connect Gmail</h2>
    <p>Read-only access through Activepieces. Use your test mailbox with synthetic messages.</p>
    <button className="secondary-button" disabled={!!pending} onClick={() => { void connect(); }}>
      {labels ? 'Reconnect Gmail' : 'Connect Gmail'}
    </button>
    {pending && <p role="status">{pending}</p>}
    {error && <p role="alert">{error}</p>}
    {labels && (labels.length ? <>
      <p>Gmail connected. Choose the test label.</p>
      <label>Gmail label<select value={labelId} disabled={!!pending} onChange={event => {
        setLabelId(event.target.value);
        setResult('');
      }}>
        <option value="">Choose a label</option>
        {labels.map(label => <option key={label.id} value={label.id}>{label.name}</option>)}
      </select></label>
      <button className="secondary-button" disabled={!labelId || !!pending} onClick={() => { void read(); }}>Read test messages</button>
      <p>This proof reads at most three messages from the selected test label.</p>
    </> : <p>No S4 synthetic label found. Create it in Gmail, then reconnect.</p>)}
    {result && <p role="status">{result}</p>}
  </section>;
}
