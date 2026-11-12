import { useState } from 'react';

type Label = { id: string; name: string };
type Counts = { pages: number; messages: number };
export interface GmailTestActions {
  connect(): Promise<Label[]>;
  backfill(label: string): Promise<Counts>;
  incremental(): Promise<Counts>;
}

const errorMessages: Record<string, string> = {
  google_sign_in_cancelled: 'Google sign-in was cancelled. You can try again.',
  google_sign_in_expired: 'Google sign-in timed out. Try again.',
  google_readonly_grant_required: 'Grant read-only Gmail access when Google asks.',
  wrong_google_account: 'Sign in with the designated test account.',
  no_backfill_messages: 'No recent messages found. Label one synthetic message and try again.',
  no_incremental_messages: 'No new messages found. Apply the test label to a second message and try again.',
  gmail_history_expired: 'The Gmail history checkpoint expired. Run backfill again.',
};

async function request<Result>(action: string, label?: string): Promise<Result> {
  const query = label === undefined ? '' : `?${new URLSearchParams({ label })}`;
  const response = await fetch(`/__fulcrum/gmail-test/${action}${query}`, { method: 'POST' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

export const gmailTestActions: GmailTestActions = {
  connect: () => request('connect'),
  backfill: label => request('backfill', label),
  incremental: () => request('incremental'),
};

function countLabel(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

export function GmailTest({ actions }: { actions: GmailTestActions }) {
  const [labels, setLabels] = useState<Label[]>();
  const [label, setLabel] = useState('');
  const [backfill, setBackfill] = useState<Counts>();
  const [incremental, setIncremental] = useState<Counts>();
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');

  async function run<Result>(message: string, action: () => Promise<Result>, save: (result: Result) => void) {
    setError('');
    setPending(message);
    try {
      save(await action());
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : '';
      setError(errorMessages[code] ?? 'The Gmail test could not finish. Try again.');
    } finally {
      setPending('');
    }
  }

  function clearScans() {
    setBackfill(undefined);
    setIncremental(undefined);
  }

  function connect() {
    setLabels(undefined);
    setLabel('');
    clearScans();
    void run('Finish signing in with Google in your browser.', actions.connect, setLabels);
  }

  function scan() {
    clearScans();
    void run('Reading recent test messages…', () => actions.backfill(label), setBackfill);
  }

  return <section className="settings-content" aria-labelledby="gmail-test-heading">
    <h2 id="gmail-test-heading">Gmail connection test</h2>
    <p>Use the designated Gmail test account with synthetic messages.</p>
    <button className="secondary-button" disabled={!!pending} onClick={connect}>
      {labels ? 'Reconnect Gmail' : 'Connect Gmail'}
    </button>
    {pending && <p role="status">{pending}</p>}
    {error && <p role="alert">{error}</p>}
    {labels && (labels.length ? <>
      <label>Gmail label<select value={label} disabled={!!pending} onChange={event => {
        setLabel(event.target.value);
        setError('');
        clearScans();
      }}>
        <option value="">Choose a label</option>
        {labels.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select></label>
      <button className="secondary-button" disabled={!label || !!pending} onClick={scan}>Run backfill</button>
    </> : <p>Create a test label in Gmail, then reconnect.</p>)}
    {backfill && <>
      <p>Backfill read {countLabel(backfill.messages, 'message')} across {countLabel(backfill.pages, 'page')}.</p>
      <p>Apply the same label to one more synthetic message before checking for new mail.</p>
      <button className="secondary-button" disabled={!!pending} onClick={() => {
        setIncremental(undefined);
        void run('Checking for new test messages…', actions.incremental, setIncremental);
      }}>Check for new mail</button>
    </>}
    {incremental && <p role="status">Incremental sync read {countLabel(incremental.messages, 'message')} across {countLabel(incremental.pages, 'page')}.</p>}
  </section>;
}
