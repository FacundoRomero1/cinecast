/**
 * Generador dinámico de posters estilizados SVG de alta definición cinematográfica.
 * Se utiliza como fallback inmediato en onError para que NUNCA aparezca una imagen rota.
 */
export function createStyledPosterFallback(title: string, category: string = 'Cine'): string {
  const cleanTitle = (title || 'CineCast')
    .replace(/[<>&"']/g, '')
    .substring(0, 40);
  const cleanCat = (category || 'CineCast').toUpperCase().substring(0, 16);

  const line1 = cleanTitle.length > 22 ? cleanTitle.substring(0, 22) : cleanTitle;
  const line2 = cleanTitle.length > 22 ? cleanTitle.substring(22, 40) : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 750" width="500" height="750">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#1c1917"/>
        <stop offset="50%" stop-color="#0c0a09"/>
        <stop offset="100%" stop-color="#000000"/>
      </linearGradient>
      <linearGradient id="accentGlow" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#dc2626" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="500" height="750" fill="url(#bg)"/>
    <circle cx="250" cy="240" r="210" fill="url(#accentGlow)"/>
    <rect x="20" y="20" width="460" height="710" rx="20" fill="none" stroke="#292524" stroke-width="2"/>
    
    <!-- Cinema Icon Badge -->
    <g transform="translate(250, 230)">
      <circle cx="0" cy="0" r="48" fill="#dc2626" fill-opacity="0.15" stroke="#ef4444" stroke-width="2"/>
      <polygon points="-12,-20 22,0 -12,20" fill="#ffffff"/>
    </g>
    
    <!-- Category Pill -->
    <g transform="translate(250, 325)">
      <rect x="-65" y="-14" width="130" height="28" rx="14" fill="#dc2626" fill-opacity="0.25" stroke="#ef4444" stroke-width="1.5"/>
      <text x="0" y="4" text-anchor="middle" fill="#f87171" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="800" font-size="11" letter-spacing="1.5">${cleanCat}</text>
    </g>
    
    <!-- Title -->
    <text x="250" y="405" text-anchor="middle" fill="#f5f5f4" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="26">
      <tspan x="250" dy="0">${line1}</tspan>
      ${line2 ? `<tspan x="250" dy="32">${line2}</tspan>` : ''}
    </text>
    
    <!-- Branding Bottom -->
    <text x="250" y="685" text-anchor="middle" fill="#78716c" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="12" letter-spacing="3">CINECAST • STREAMING HD</text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
