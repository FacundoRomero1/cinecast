import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Ensure window.fetch setter compatibility in iframe environments
try {
  let activeFetch = window.fetch;
  const desc = Object.getOwnPropertyDescriptor(window, 'fetch');
  if (!desc || desc.configurable !== false) {
    Object.defineProperty(window, 'fetch', {
      get() {
        return activeFetch;
      },
      set(fn) {
        activeFetch = fn;
      },
      configurable: true,
      enumerable: true,
    });
  }
} catch (_) {}

createRoot(document.getElementById('root')!).render(<App />);
