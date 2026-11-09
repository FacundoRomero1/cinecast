import { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useBookmarks } from '../../hooks/useBookmarks';
import './Navbar.css';

export function Navbar() {
  const { bookmarksCount } = useBookmarks();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
  };

  return (
    <header className="navbar">
      <div className="navbar__container">
        {/* Brand Logo */}
        <Link to="/" className="navbar__brand" onClick={closeMobileMenu}>
          <div className="brand-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
          <span className="brand-title">
            CINEMATE<span className="brand-dot">.</span>
          </span>
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="navbar__nav" aria-label="Navegación principal">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}
          >
            Inicio
          </NavLink>

          <NavLink
            to="/marcadores"
            className={({ isActive }) => `nav-link nav-link--bookmarks ${isActive ? 'is-active' : ''}`}
          >
            <span>Marcadores</span>
            {bookmarksCount > 0 && (
              <span key={bookmarksCount} className="nav-counter-badge is-bumped">
                {bookmarksCount}
              </span>
            )}
          </NavLink>

          <NavLink
            to="/mochila"
            className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}
          >
            Mochila
          </NavLink>

          <NavLink
            to="/contacto"
            className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}
          >
            Contacto
          </NavLink>

          <NavLink
            to="/admin"
            className={({ isActive }) => `nav-link nav-link--admin ${isActive ? 'is-active' : ''}`}
          >
            Admin
          </NavLink>
        </nav>

        {/* Mobile Hamburger Toggle */}
        <button
          type="button"
          className="mobile-toggle"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          aria-label={mobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="mobile-drawer">
          <nav className="mobile-nav">
            <NavLink
              to="/"
              end
              onClick={closeMobileMenu}
              className={({ isActive }) => `mobile-nav-link ${isActive ? 'is-active' : ''}`}
            >
              Inicio
            </NavLink>

            <NavLink
              to="/marcadores"
              onClick={closeMobileMenu}
              className={({ isActive }) => `mobile-nav-link ${isActive ? 'is-active' : ''}`}
            >
              <span>Marcadores</span>
              {bookmarksCount > 0 && (
                <span key={bookmarksCount} className="mobile-counter-badge">
                  {bookmarksCount}
                </span>
              )}
            </NavLink>

            <NavLink
              to="/mochila"
              onClick={closeMobileMenu}
              className={({ isActive }) => `mobile-nav-link ${isActive ? 'is-active' : ''}`}
            >
              Mochila
            </NavLink>

            <NavLink
              to="/contacto"
              onClick={closeMobileMenu}
              className={({ isActive }) => `mobile-nav-link ${isActive ? 'is-active' : ''}`}
            >
              Contacto
            </NavLink>

            <NavLink
              to="/admin"
              onClick={closeMobileMenu}
              className={({ isActive }) => `mobile-nav-link ${isActive ? 'is-active' : ''}`}
            >
              Admin
            </NavLink>
          </nav>
        </div>
      )}
    </header>
  );
}
