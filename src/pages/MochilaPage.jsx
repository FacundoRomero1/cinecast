import { Link } from 'react-router-dom';
import './PlaceholderPage.css';

export function MochilaPage() {
  return (
    <div className="placeholder-page">
      <div className="placeholder-icon-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 20h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3l-2-3H9L7 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
      </div>
      <span className="placeholder-badge">Módulo en Desarrollo</span>
      <h1 className="placeholder-title">Módulo Mochila</h1>
      <p className="placeholder-desc">
        Tu espacio para descargas temporales, listas personalizadas y cola de reproducción de contenidos.
      </p>
      <Link to="/marcadores" className="placeholder-btn">
        Ver mis marcadores guardados →
      </Link>
    </div>
  );
}
