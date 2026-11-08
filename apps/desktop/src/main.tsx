import { createRoot } from 'react-dom/client';
import { App } from './ui/app.js';
import { platform } from './platform/current.js';
import './ui/tokens.css';
createRoot(document.getElementById('root')!).render(<App platform={platform} />);
