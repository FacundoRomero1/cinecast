import React from 'react';

export const CardSkeleton: React.FC = () => (
  <div
    aria-hidden="true"
    className="flex flex-col rounded-xl bg-zinc-900/70 border border-zinc-800/70 overflow-hidden animate-pulse"
  >
    <div className="aspect-[2/3] w-full bg-zinc-800/80" />
    <div className="p-2.5 space-y-2">
      <div className="h-3.5 bg-zinc-800 rounded w-3/4" />
      <div className="h-3 bg-zinc-800/70 rounded w-1/2" />
    </div>
  </div>
);

export const HeroSkeleton: React.FC = () => (
  <div
    aria-hidden="true"
    className="w-full min-h-[380px] sm:min-h-[460px] rounded-2xl bg-zinc-900/70 border border-zinc-800/70 p-6 sm:p-10 flex flex-col justify-end gap-3 animate-pulse mb-6"
  >
    <div className="h-4 w-36 bg-zinc-800 rounded" />
    <div className="h-10 w-2/3 max-w-md bg-zinc-800 rounded" />
    <div className="h-4 w-full max-w-xl bg-zinc-800/70 rounded" />
    <div className="flex gap-3 pt-2">
      <div className="h-11 w-32 bg-zinc-800 rounded-xl" />
      <div className="h-11 w-32 bg-zinc-800 rounded-xl" />
    </div>
  </div>
);

export const GridSkeleton: React.FC<{ count?: number }> = ({ count = 12 }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
    {Array.from({ length: count }).map((_, idx) => (
      <CardSkeleton key={idx} />
    ))}
  </div>
);
