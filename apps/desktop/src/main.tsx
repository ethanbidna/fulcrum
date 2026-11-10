import { createRoot } from 'react-dom/client';
import { DesktopRoot } from './ui/desktop-root.js';
import { platform } from './platform/current.js';
import './ui/tokens.css';
createRoot(document.getElementById('root')!).render(<DesktopRoot platform={platform} />);
