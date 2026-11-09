import { useState } from 'react';
import { useBookmarks } from '../../hooks/useBookmarks';
import './BookmarkButton.css';

/**
 * Reusable Bookmark Button with active micro-animations and flexible styling.
 * @param {Object} props
 * @param {Object} props.item - Media item object (must contain at least `id`)
 * @param {'icon' | 'pill'} [props.variant='icon'] - Visual presentation style
 * @param {boolean} [props.showLabel=false] - Display text next to icon
 * @param {string} [props.className=''] - Optional extra classes
 */
export function BookmarkButton({
  item,
  variant = 'icon',
  showLabel = false,
  className = '',
}) {
  const { isBookmarked, toggleBookmark } = useBookmarks();
  const [isAnimating, setIsAnimating] = useState(false);

  if (!item) return null;

  const active = isBookmarked(item.id);

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsAnimating(true);
    toggleBookmark(item);
    setTimeout(() => setIsAnimating(false), 400);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`bookmark-btn bookmark-btn--${variant} ${active ? 'is-active' : ''} ${isAnimating ? 'animate-pop' : ''} ${className}`}
      title={active ? 'Quitar de mis marcadores' : 'Guardar en marcadores'}
      aria-label={active ? 'Quitar de mis marcadores' : 'Guardar en marcadores'}
    >
      <svg
        className="bookmark-icon"
        viewBox="0 0 24 24"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      {showLabel && (
        <span className="bookmark-label">
          {active ? 'Guardado' : 'Guardar'}
        </span>
      )}
    </button>
  );
}
