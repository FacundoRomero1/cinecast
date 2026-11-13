import React from 'react';
import { createRoot } from 'react-dom/client';
import { NewApp } from './ui/NewApp.tsx';
import './index.css';
import { initTimeTracker } from './app/timeTracker';

initTimeTracker();

// Ajuste Prioritario A: Limpiar flag de UI v2 e ignorar cualquier valor de ?ui=
try {
  localStorage.removeItem('cinecast_ui_v2');
} catch (_) {}

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

const RootContainer: React.FC = () => {
  return <NewApp />;
};

createRoot(document.getElementById('root')!).render(<RootContainer />);
