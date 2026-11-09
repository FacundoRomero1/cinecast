import { Link } from 'react-router-dom';
import { MOCK_MEDIA } from '../data/mockMedia';
import { BookmarkButton } from '../components/common/BookmarkButton';
import { createStyledPosterFallback } from '../utils/imageUtils';
import './HomePage.css';

export function HomePage() {
  const heroItem = MOCK_MEDIA[0]; // Featured item (Dune: Part Two)

  const movies = MOCK_MEDIA.filter((m) => m.type === 'movie');
  const series = MOCK_MEDIA.filter((m) => m.type === 'tv');
  const animes = MOCK_MEDIA.filter((m) => m.type === 'anime');
  const matches = MOCK_MEDIA.filter((m) => m.type === 'match');

  return (
    <div className="home-page">
      {/* Hero Showcase Banner */}
      <section className="hero-banner">
        <div
          className="hero-backdrop"
          style={{ backgroundImage: `url(${heroItem.backdropUrl})` }}
        />
        <div className="hero-gradient-overlay" />

        <div className="hero-content">
          <div className="hero-badge">Destacado de la semana</div>
          <h1 className="hero-title">{heroItem.title}</h1>

          <div className="hero-meta">
            <span className="hero-rating">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              {heroItem.rating}
            </span>
            <span className="hero-year">{heroItem.year}</span>
            <span className="hero-tag">Ciencia Ficción / Aventura</span>
          </div>

          <p className="hero-overview">{heroItem.overview}</p>

          <div className="hero-actions">
            <button type="button" className="hero-play-btn">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span>Reproducir</span>
            </button>

            <BookmarkButton
              item={heroItem}
              variant="pill"
              showLabel={true}
              className="hero-bookmark-btn"
            />

            <Link to="/marcadores" className="hero-view-bookmarks-btn">
              Ir a mis marcadores →
            </Link>
          </div>
        </div>
      </section>

      {/* Catalog Sections */}
      <div className="catalog-sections">
        {/* Películas Section */}
        <section className="media-section">
          <div className="section-header">
            <h2 className="section-title">
              <span className="section-icon">🎬</span> Películas recomendadas
            </h2>
          </div>
          <div className="media-row">
            {movies.map((item) => (
              <CatalogCard key={item.id} item={item} />
            ))}
          </div>
        </section>

        {/* Series Section */}
        <section className="media-section">
          <div className="section-header">
            <h2 className="section-title">
              <span className="section-icon">📺</span> Series populares
            </h2>
          </div>
          <div className="media-row">
            {series.map((item) => (
              <CatalogCard key={item.id} item={item} />
            ))}
          </div>
        </section>

        {/* Anime Section */}
        <section className="media-section">
          <div className="section-header">
            <h2 className="section-title">
              <span className="section-icon">⚡</span> Anime en tendencia
            </h2>
          </div>
          <div className="media-row">
            {animes.map((item) => (
              <CatalogCard key={item.id} item={item} />
            ))}
          </div>
        </section>

        {/* Deportes Section */}
        <section className="media-section">
          <div className="section-header">
            <h2 className="section-title">
              <span className="section-icon">⚽</span> Partidos y transmisiones en vivo
            </h2>
          </div>
          <div className="media-row">
            {matches.map((item) => (
              <CatalogCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Interactive card in the catalog with BookmarkButton attached.
 */
function CatalogCard({ item }) {
  return (
    <div className="catalog-card">
      <div className="catalog-card__media">
        <img
          src={item.posterUrl}
          alt={item.title}
          className="catalog-card__img"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.src = createStyledPosterFallback(item.title, item.type);
          }}
        />

        {/* Bookmark action pinned top right */}
        <div className="catalog-card__bookmark">
          <BookmarkButton item={item} variant="icon" />
        </div>

        {/* Rating badge */}
        <div className="catalog-card__rating">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span>{item.rating}</span>
        </div>
      </div>

      <div className="catalog-card__info">
        <h3 className="catalog-card__title" title={item.title}>
          {item.title}
        </h3>
        <div className="catalog-card__meta">
          <span>{item.year}</span>
          <span className="meta-sep">•</span>
          <span className="meta-type-name">
            {item.type === 'movie' && 'Película'}
            {item.type === 'tv' && 'Serie'}
            {item.type === 'anime' && 'Anime'}
            {item.type === 'match' && 'Partido'}
          </span>
        </div>
      </div>
    </div>
  );
}
