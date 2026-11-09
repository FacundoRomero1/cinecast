import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBookmarks } from '../hooks/useBookmarks';
import { BookmarksGrid } from '../components/bookmarks/BookmarksGrid';
import './BookmarksPage.css';

export function BookmarksPage() {
  const { bookmarks, bookmarksCount, clearBookmarks } = useBookmarks();
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const handleClear = () => {
    clearBookmarks();
    setShowConfirmClear(false);
  };

  return (
    <div className="bookmarks-page">
      {/* Page Header */}
      <header className="bookmarks-header">
        <div className="bookmarks-header__main">
          <div className="header-badge">
            <span className="header-badge__dot"></span>
            <span>Módulo de Favoritos</span>
          </div>
          <h1 className="bookmarks-title">Mis Marcadores</h1>
          <p className="bookmarks-subtitle">
            Tu lista curada de películas, series, anime y transmisiones deportivas para ver cuando quieras.
          </p>
        </div>

        {bookmarksCount > 0 && (
          <div className="bookmarks-header__actions">
            <div className="bookmarks-count-pill">
              <span className="count-number">{bookmarksCount}</span>
              <span className="count-text">
                {bookmarksCount === 1 ? 'guardado' : 'guardados'}
              </span>
            </div>

            {!showConfirmClear ? (
              <button
                type="button"
                className="clear-all-btn"
                onClick={() => setShowConfirmClear(true)}
                title="Vaciar todos los marcadores"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                <span>Limpiar lista</span>
              </button>
            ) : (
              <div className="confirm-clear-box">
                <span className="confirm-text">¿Vaciar lista?</span>
                <button
                  type="button"
                  className="confirm-yes-btn"
                  onClick={handleClear}
                >
                  Sí, vaciar
                </button>
                <button
                  type="button"
                  className="confirm-no-btn"
                  onClick={() => setShowConfirmClear(false)}
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Main Content: Grid or Empty State */}
      {bookmarksCount > 0 ? (
        <BookmarksGrid bookmarks={bookmarks} />
      ) : (
        <div className="bookmarks-empty">
          <div className="empty-illustration">
            <div className="empty-glow"></div>
            <div className="empty-icon-card">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </div>
          </div>

          <h2 className="empty-title">Tu lista de marcadores está vacía</h2>
          <p className="empty-desc">
            Aún no has guardado películas, series ni eventos. Toca el ícono de
            marcador en cualquier contenido para tenerlo a mano en esta pantalla.
          </p>

          <Link to="/" className="empty-cta-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>Explorar contenido disponible</span>
          </Link>
        </div>
      )}
    </div>
  );
}
