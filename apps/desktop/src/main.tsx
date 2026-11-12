import { createRoot } from 'react-dom/client';
import { GmailTest, gmailTestActions } from './ui/gmail-test.js';
import { DesktopRoot } from './ui/desktop-root.js';
import { platform } from './platform/current.js';
import './ui/tokens.css';
const gmailTest = import.meta.env.DEV && import.meta.env.VITE_FULCRUM_GMAIL_TEST === 'enabled';
createRoot(document.getElementById('root')!).render(gmailTest
  ? <main><h1>Fulcrum</h1><GmailTest actions={gmailTestActions}/></main>
  : <DesktopRoot platform={platform} />);
