import { useState } from 'react';
import { useBookmarks } from '../../hooks/useBookmarks';
import './BookmarkCard.css';

const TYPE_CONFIG = {
  movie: { label: 'Película', colorClass: 'badge--movie' },
  tv: { label: 'Serie', colorClass: 'badge--tv' },
  anime: { label: 'Anime', colorClass: 'badge--anime' },
  match: { label: 'Partido', colorClass: 'badge--match' },
};

/**
 * Card representing a bookmarked media item.
 * @param {Object} props
 * @param {Object} props.item - Media item data
 */
export function BookmarkCard({ item }) {
  const { removeBookmark } = useBookmarks();
  const [imgError, setImgError] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const typeInfo = TYPE_CONFIG[item.type] || { label: 'Contenido', colorClass: 'badge--default' };

  const handleRemove = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRemoving(true);
    // Smooth exit animation before removing from state
    setTimeout(() => {
      removeBookmark(item.id);
    }, 250);
  };

  const formattedDate = item.addedAt
    ? new Date(item.addedAt).toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'short',
      })
    : null;

  return (
    <article className={`bookmark-card ${isRemoving ? 'is-removing' : ''}`}>
      <div className="bookmark-card__media">
        {item.posterUrl && !imgError ? (
          <img
            src={item.posterUrl}
            alt={item.title}
            className="bookmark-card__image"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="bookmark-card__fallback">
            <svg
              className="fallback-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
              <line x1="7" y1="2" x2="7" y2="22" />
              <line x1="17" y1="2" x2="17" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <line x1="2" y1="7" x2="7" y2="7" />
              <line x1="2" y1="17" x2="7" y2="17" />
              <line x1="17" y1="17" x2="22" y2="17" />
              <line x1="17" y1="7" x2="22" y2="7" />
            </svg>
            <span className="fallback-text">{item.title}</span>
          </div>
        )}

        {/* Top Badges */}
        <div className="bookmark-card__top">
          <span className={`type-badge ${typeInfo.colorClass}`}>
            {typeInfo.label}
          </span>

          <button
            type="button"
            className="remove-btn"
            onClick={handleRemove}
            title="Quitar de marcadores"
            aria-label={`Quitar ${item.title} de marcadores`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Floating Rating */}
        {item.rating > 0 && (
          <div className="bookmark-card__rating">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <span>{Number(item.rating).toFixed(1)}</span>
          </div>
        )}

        {/* Hover Overlay with Quick Actions */}
        <div className="bookmark-card__overlay">
          <div className="overlay-play-btn" title="Reproducir contenido">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>

          <div className="overlay-info">
            <div className="overlay-meta">
              {item.year && <span className="meta-year">{item.year}</span>}
              {formattedDate && (
                <span className="meta-added">Guardado el {formattedDate}</span>
              )}
            </div>
            {item.overview && (
              <p className="overlay-overview">{item.overview}</p>
            )}
          </div>
        </div>
      </div>

      {/* Card Footer Info */}
      <div className="bookmark-card__footer">
        <h3 className="bookmark-card__title" title={item.title}>
          {item.title}
        </h3>
        <div className="bookmark-card__submeta">
          <span className="submeta-type">{typeInfo.label}</span>
          {item.year && <span className="submeta-dot">•</span>}
          {item.year && <span>{item.year}</span>}
        </div>
      </div>
    </article>
  );
}
