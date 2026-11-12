import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CardItem } from '../providers/types';
import { TitleCard } from './TitleCard';
import type { PosterWidth } from './liteMode';

export interface RowProps {
  title: string;
  items: CardItem[];
  onSelectItem: (item: CardItem) => void;
  onPlayItem?: ((item: CardItem) => void) | undefined;
  onCastItem?: ((item: CardItem) => void) | undefined;
  connectedScreenName?: string | undefined;
  lite?: boolean | undefined;
  posterWidth?: PosterWidth | undefined;
}

export const Row: React.FC<RowProps> = ({
  title,
  items,
  onSelectItem,
  onPlayItem,
  onCastItem,
  connectedScreenName,
  lite = false,
  posterWidth = 185,
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const initialCount = lite ? 8 : 10;
  const [visibleCount, setVisibleCount] = useState<number>(initialCount);

  useEffect(() => {
    setVisibleCount(initialCount);
  }, [items, initialCount]);

  if (!items || items.length === 0) return null;

  const visibleItems = items.slice(0, visibleCount);

  const expandIfNeeded = () => {
    setVisibleCount((prev) => (prev < items.length ? Math.min(items.length, prev + 10) : prev));
  };

  const scrollByAmount = (direction: 'left' | 'right') => {
    const el = scrollerRef.current;
    if (!el) return;
    if (direction === 'right') expandIfNeeded();
    const delta = Math.max(320, Math.floor(el.clientWidth * 0.75));
    el.scrollBy({
      left: direction === 'left' ? -delta : delta,
      behavior: lite ? 'auto' : 'smooth',
    });
  };

  const handleHorizontalScroll = () => {
    const el = scrollerRef.current;
    if (!el || visibleCount >= items.length) return;
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 260) {
      expandIfNeeded();
    }
  };

  return (
    <section className="relative py-3" aria-label={title}>
      <div className="flex items-center justify-between px-4 sm:px-8 mb-3">
        <h2 className="text-base sm:text-lg font-bold text-zinc-100 tracking-tight">{title}</h2>

        <div className="hidden md:flex items-center gap-2">
          <button
            type="button"
            tabIndex={0}
            aria-label={`Desplazar ${title} a la izquierda`}
            onClick={() => scrollByAmount('left')}
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            tabIndex={0}
            aria-label={`Desplazar ${title} a la derecha`}
            onClick={() => scrollByAmount('right')}
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        onScroll={handleHorizontalScroll}
        className={`flex gap-3.5 overflow-x-auto no-scrollbar ${lite ? '' : 'scroll-smooth'} px-4 sm:px-8 pb-2`}
      >
        {visibleItems.map((item) => (
          <div key={item.id} className="w-[148px] sm:w-[172px] shrink-0">
            <TitleCard
              item={item}
              onSelect={onSelectItem}
              onPlay={onPlayItem}
              onCast={onCastItem}
              connectedScreenName={connectedScreenName}
              posterWidth={posterWidth}
            />
          </div>
        ))}
      </div>
    </section>
  );
};
