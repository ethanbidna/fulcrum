import { useState } from 'react';
import type { CommandEnvelope, CommandResult } from '@fulcrum/domain';
import { moscowLabels } from './portfolio-model.js';
export type ExecuteCommand = (command: Omit<CommandEnvelope, 'actor'>) => Promise<CommandResult>;
export function NewInitiative({ execute, close }: { execute: ExecuteCommand; close: () => void }) {
  const [title, setTitle] = useState(''); const [moscow, setMoscow] = useState('');
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  return <form className="new-initiative" aria-label="New initiative" onSubmit={event => {
    event.preventDefault(); if (pending || !title.trim()) return;
    setPending(true); setError('');
    void execute({ name: 'initiative.create', args: { record: { id: crypto.randomUUID(), title: title.trim(), moscow: moscow || null, categoryIds: [] } } })
      .then(result => { if (result.ok) close(); else setError(result.error.message); }).catch(() => setError('Could not save. Check the core connection and try again.')).finally(() => setPending(false));
  }}><h2>New initiative</h2><label>Name<input autoFocus required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} disabled={pending} /></label><label>MoSCoW<select value={moscow} onChange={event => setMoscow(event.target.value)} disabled={pending}><option value="">Not set</option>{Object.entries(moscowLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>{error && <p role="alert">{error}</p>}<div className="form-actions"><button className="primary-button" disabled={pending || !title.trim()}>{pending ? 'Creating…' : 'Create initiative'}</button><button type="button" className="secondary-button" onClick={close} disabled={pending}>Cancel</button></div></form>;
}
