import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Safari < 17.4 n'a pas Promise.withResolvers, que pdf.js 5 utilise (12/11 : lectures de PDF en échec chez Achille).
const P = Promise as unknown as { withResolvers?: unknown };
if (typeof P.withResolvers !== 'function') {
  P.withResolvers = function withResolvers<T>() { let resolve!: (v: T | PromiseLike<T>) => void; let reject!: (e?: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
