import { Link } from 'react-router-dom';
import './PlaceholderPage.css';

export function ContactoPage() {
  return (
    <div className="placeholder-page">
      <div className="placeholder-icon-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      </div>
      <span className="placeholder-badge">Módulo en Desarrollo</span>
      <h1 className="placeholder-title">Módulo Contacto</h1>
      <p className="placeholder-desc">
        Canal directo para reportar enlaces caídos, solicitar nuevas películas, series o sugerir mejoras para Cinemate.
      </p>
      <Link to="/" className="placeholder-btn">
        ← Volver al catálogo de inicio
      </Link>
    </div>
  );
}
