import { createRoot } from 'react-dom/client';
import { ManagedGmailProof } from '../../../apps/desktop/src/ui/managed-gmail-proof.js';
import '../../../apps/desktop/src/ui/tokens.css';
import { acceptsOAuthReply } from './reply.mjs';

const CALLBACK_TIMEOUT_MS = 5 * 60_000;
const CLOSED_POLL_MS = 500;

async function request(action: string, body: object = {}) {
  const response = await fetch(`/api/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('managed_connection_failed');
  return response.json();
}

function receiveCode(popup: Window): Promise<string> {
  return new Promise((resolve, reject) => {
    function close() {
      window.removeEventListener('message', receive);
      clearTimeout(timeout);
      clearInterval(closed);
      popup.close();
    }
    function receive(event: MessageEvent) {
      if (!acceptsOAuthReply(event, popup)) return;
      close();
      try { resolve(decodeURIComponent(event.data.code)); } catch { reject(new Error('invalid_oauth_reply')); }
    }
    const timeout = setTimeout(() => { close(); reject(new Error('google_sign_in_expired')); }, CALLBACK_TIMEOUT_MS);
    const closed = setInterval(() => {
      if (!popup.closed) return;
      close();
      reject(new Error('google_sign_in_cancelled'));
    }, CLOSED_POLL_MS);
    window.addEventListener('message', receive);
  });
}

async function connect() {
  const popup = window.open('about:blank', '_blank', 'popup,width=600,height=800');
  if (!popup) throw new Error('popup_blocked');
  try {
    const attempt = await request('begin');
    const code = receiveCode(popup);
    popup.location.href = attempt.authorizationUrl;
    return await request('complete', { attemptId: attempt.attemptId, code: await code });
  } catch (error) {
    popup.close();
    throw error;
  }
}

createRoot(document.getElementById('root')!).render(<main><h1>Fulcrum</h1>
  <ManagedGmailProof actions={{ connect, read: labelId => request('read', { labelId }) }} />
</main>);
