import React, { Suspense } from 'react';
import { NewApp } from './ui/NewApp';

export const App: React.FC = () => {
  return (
    <Suspense
      fallback={
        <div className="w-full h-screen bg-black flex items-center justify-center text-white">
          Cargando...
        </div>
      }
    >
      <NewApp />
    </Suspense>
  );
};

export default App;
