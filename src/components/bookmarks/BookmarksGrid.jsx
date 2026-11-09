import { useState, useMemo } from 'react';
import { BookmarkCard } from './BookmarkCard';
import './BookmarksGrid.css';

const CATEGORIES = [
  { id: 'all', label: 'Todos' },
  { id: 'movie', label: 'Películas' },
  { id: 'tv', label: 'Series' },
  { id: 'anime', label: 'Anime' },
  { id: 'match', label: 'Partidos' },
];

/**
 * Grid layout with dynamic filtering, sorting, and search for bookmarked media.
 * @param {Object} props
 * @param {Array<Object>} props.bookmarks - Array of bookmarks from context
 */
export function BookmarksGrid({ bookmarks }) {
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent');

  // Calculate category counts
  const counts = useMemo(() => {
    const res = { all: bookmarks.length, movie: 0, tv: 0, anime: 0, match: 0 };
    bookmarks.forEach((item) => {
      if (res[item.type] !== undefined) {
        res[item.type] += 1;
      }
    });
    return res;
  }, [bookmarks]);

  // Filter and sort items
  const filteredBookmarks = useMemo(() => {
    return bookmarks
      .filter((item) => {
        // Category match
        if (activeCategory !== 'all' && item.type !== activeCategory) {
          return false;
        }
        // Search match
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const title = (item.title || '').toLowerCase();
          const overview = (item.overview || '').toLowerCase();
          return title.includes(q) || overview.includes(q);
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'recent') {
          return (b.addedAt || 0) - (a.addedAt || 0);
        }
        if (sortBy === 'rating') {
          return (b.rating || 0) - (a.rating || 0);
        }
        if (sortBy === 'alpha') {
          return (a.title || '').localeCompare(b.title || '');
        }
        return 0;
      });
  }, [bookmarks, activeCategory, searchQuery, sortBy]);

  return (
    <div className="bookmarks-grid-section">
      {/* Controls Bar: Categories & Search/Sort */}
      <div className="bookmarks-controls">
        {/* Category Pills */}
        <div className="category-filters" role="tablist" aria-label="Filtrar por categoría">
          {CATEGORIES.map((cat) => {
            const count = counts[cat.id] || 0;
            const isActive = activeCategory === cat.id;

            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`category-pill ${isActive ? 'is-active' : ''}`}
                onClick={() => setActiveCategory(cat.id)}
              >
                <span>{cat.label}</span>
                <span className="category-pill__badge">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Search & Sort Row */}
        <div className="search-sort-group">
          {/* Search Box */}
          <div className="search-box">
            <svg
              className="search-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Buscar en marcadores..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearchQuery('')}
                title="Limpiar búsqueda"
              >
                ✕
              </button>
            )}
          </div>

          {/* Sort Selector */}
          <div className="sort-selector">
            <label htmlFor="sort-select" className="sort-label">Ordenar:</label>
            <select
              id="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="sort-dropdown"
            >
              <option value="recent">Más recientes</option>
              <option value="rating">Mejor valoradas</option>
              <option value="alpha">Nombre (A - Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid or Filter Empty State */}
      {filteredBookmarks.length > 0 ? (
        <div className="bookmarks-grid">
          {filteredBookmarks.map((item) => (
            <BookmarkCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="filter-empty-state">
          <svg
            className="filter-empty-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
          <p className="filter-empty-title">
            No se encontraron elementos en esta categoría
          </p>
          <p className="filter-empty-desc">
            Prueba cambiando el filtro seleccionado o el texto de búsqueda.
          </p>
          {(activeCategory !== 'all' || searchQuery) && (
            <button
              type="button"
              className="reset-filters-btn"
              onClick={() => {
                setActiveCategory('all');
                setSearchQuery('');
              }}
            >
              Restablecer filtros
            </button>
          )}
        </div>
      )}
    </div>
  );
}
