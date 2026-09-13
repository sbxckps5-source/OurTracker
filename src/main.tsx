import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Intercept harmless SheetJS zip uncompressed size warnings from third-party broker excel files
if (typeof window !== 'undefined') {
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const firstArg = typeof args[0] === 'string' ? args[0] : '';
    if (
      firstArg.includes('Bad uncompressed size') ||
      firstArg.includes('Bad compressed size') ||
      firstArg.includes('Bad CRC32 checksum')
    ) {
      // Benign SheetJS warning on broker zip formats, suppress from error monitor
      return;
    }
    originalConsoleError.apply(console, args);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
