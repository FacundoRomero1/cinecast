export const CANONICAL_GENRES = [
  'Drama',
  'Comedia',
  'Animación',
  'Acción',
  'Suspenso',
  'Crimen',
  'Aventura',
  'Familia',
  'Romance',
  'Misterio',
  'Terror',
  'Documental',
  'Ciencia Ficción',
  'Fantasía',
  'Western',
  'Bélica',
  'Infantil',
] as const;

export type CanonicalGenre = (typeof CANONICAL_GENRES)[number];

const EXCLUDED_GENRES = new Set(['Anime', 'Cine', 'Película']);

export function normalizeGenres(genres: string[], _category: string): string[] {
  if (!Array.isArray(genres)) return [];
  const result: string[] = [];
  const seen = new Set<string>();

  const pushUnique = (raw: string) => {
    const g = String(raw || '').trim();
    if (!g || EXCLUDED_GENRES.has(g)) return;
    if (!seen.has(g)) {
      seen.add(g);
      result.push(g);
    }
  };

  for (const rawGenre of genres) {
    const g = String(rawGenre || '').trim();
    if (!g) continue;
    if (g === 'Acción y Aventura') {
      pushUnique('Acción');
      pushUnique('Aventura');
    } else if (g === 'Sci-Fi y Fantasía') {
      pushUnique('Ciencia Ficción');
      pushUnique('Fantasía');
    } else if (g === 'Guerra y Política') {
      pushUnique('Bélica');
    } else {
      pushUnique(g);
    }
  }

  return result;
}
