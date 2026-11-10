import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { NewApp } from './ui/NewApp.tsx';
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

function resolveInitialUiV2Flag(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const uiParam = params.get('ui');
    if (uiParam === 'nuevo') {
      localStorage.setItem('cinecast_ui_v2', '1');
      return true;
    }
    if (uiParam === 'clasico') {
      localStorage.removeItem('cinecast_ui_v2');
      return false;
    }
    return localStorage.getItem('cinecast_ui_v2') === '1';
  } catch (_) {
    return false;
  }
}

const RootContainer: React.FC = () => {
  const [useV2, setUseV2] = useState<boolean>(() => resolveInitialUiV2Flag());

  if (useV2) {
    return (
      <NewApp
        onDisableV2={() => {
          try {
            localStorage.removeItem('cinecast_ui_v2');
          } catch (_) {}
          setUseV2(false);
        }}
      />
    );
  }

  return <App />;
};

createRoot(document.getElementById('root')!).render(<RootContainer />);
