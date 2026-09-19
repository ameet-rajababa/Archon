import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import './theme/tokens.css';
import { applyAppearance, watchSystemMode } from './theme/appearance';

// index.html already applied the stored appearance before first paint. Re-apply
// from the parsed store (so the two can never silently diverge) and start
// following the OS, which the inline copy cannot do — it has no listener.
applyAppearance();
watchSystemMode();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
