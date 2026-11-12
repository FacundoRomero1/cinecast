# Fuentes y Generación del Catálogo (`build-catalog.mjs` y `extend-catalog.mjs`)

## 1. Generador base: `scripts/build-catalog.mjs`

El archivo `public/data/catalog.json` (**10,119 ítems**, ~**20.57 MiB**) se genera con `scripts/build-catalog.mjs` consultando la API v3 de TMDB (`https://api.themoviedb.org/3`).

### Configuración y parámetros
- **Clave API**: toma `process.env.TMDB_API_KEY` o `process.env.VITE_TMDB_API_KEY` (con clave de respaldo integrada en el script).
- **Límite de recolección**: `TARGET_TITLES = 10100`.
- **Concurrencia / Rate limit**: lotes de `BATCH_SIZE = 12` requests en paralelo con pausa `BATCH_DELAY_MS = 250` ms entre lotes y timeout de `8000` ms por request.
- **Deduplicación y escritura**: acumula en un `Map` por `id` (`tmdb-${category}-${tmdbId}`), recarga primero un `catalog.json` previo si existe y guarda de forma atómica (`catalog.json.tmp` → `catalog.json`).

### Endpoints consultados (en orden de ejecución)
1. **Películas populares y tendencias regionales** (`/discover/movie`):
   - Regiones: `MX`, `AR`, `ES` (`language=es-${region}`, `vote_count.gte=5`).
   - Ordenamientos: `popularity.desc`, `vote_count.desc`, `primary_release_date.desc`, páginas `1..30` cada uno.
2. **Películas por año de estreno** (`/discover/movie`):
   - Años `1990..2026` con paso de 2 años (`primary_release_year`), `language=es-MX`, `vote_count.gte=5`, páginas `1..12`.
3. **Películas por género** (`/discover/movie`):
   - 16 IDs de género TMDB (`28, 12, 16, 35, 80, 99, 18, 10751, 14, 27, 9648, 10749, 878, 53, 10752, 37`), `language=es-MX`, `vote_count.gte=5`, páginas `1..25`.
4. **Series por género** (`/discover/tv`):
   - 11 IDs de género TMDB (`10759, 16, 35, 80, 99, 18, 10751, 9648, 10765, 10768, 37`), `language=es-MX`, `vote_count.gte=5`, páginas `1..25`.
5. **Anime** (`/discover/tv`):
   - `with_original_language=ja&with_genres=16`, `sort_by=popularity.desc`, `language=es-MX`, páginas `1..45`.
6. **Mejor puntuadas** (`/movie/top_rated` y `/tv/top_rated`):
   - `language=es-MX`, páginas `1..30` c/u.

### Esquema de cada ítem (`convertTmdbItem`)
- Descarta ítems sin `title`/`name` o sin `poster_path`.
- Clasifica `category` en `'anime'` (animación japonesa), `'series'` o `'movie'` (`type`: `'series' | 'movie'`).
- Mapea los primeros 3 géneros vía `GENRE_MAP` (anteponiendo `'Anime'` cuando corresponde).
- Construye URLs de imágenes (`w500` para `posterUrl`, `original` para `backdropUrl`) y el array `servers` por defecto (`TukiPlay`, `VidLink Pro`, `VidEasy`, `AutoEmbed`; en runtime el servidor filtra embeds muertos como `embed.su`).

---

## 2. Extensión aditiva sin mutar el catálogo base: `scripts/extend-catalog.mjs`

Para escalar el catálogo (20k–50k+ títulos) sin reescribir ni ensuciar `public/data/catalog.json` en Git ni romper compatibilidad:

- **`public/data/catalog.json` nunca se modifica**; se lee únicamente como conjunto de exclusión (`baseIds`) para deduplicar.
- Los títulos nuevos se escriben de forma incremental y reanudable en **`public/data/catalog.extended.json`** (archivo opcional listado en `.gitignore`).
- Al iniciar, `src/server/core/catalogSchema.ts` y `catalogDb.ts` detectan ambos archivos (`catalog.json` + `catalog.extended.json`), calculan el SHA-256 combinado (`computeCatalogSourceHash`) y reconstruyen automáticamente `data/catalog.sqlite` + `items_fts` sin duplicados. En modo `CINECAST_CATALOG_ENGINE=memory`, `loadNormalizedCatalogItems()` realiza la misma fusión en memoria.

### Uso de `scripts/extend-catalog.mjs`
```bash
# Generar/ampliar hasta 2,000 títulos adicionales (reanudable)
node scripts/extend-catalog.mjs --limit 2000

# Seguir ampliando hasta 20,000 títulos adicionales desde donde quedó
node scripts/extend-catalog.mjs --limit 20000

# Reiniciar extensión desde cero
node scripts/extend-catalog.mjs --limit 5000 --reset
```

Opciones:
- `--limit N`: cantidad objetivo de ítems en `catalog.extended.json` (default `5000`).
- `--out <ruta>`: ruta de salida (default `public/data/catalog.extended.json`).
- `--batch-size N`: requests paralelos por lote (default `8`).
- `--delay-ms N`: espera entre lotes en ms (default `250`).
- `--reset`: descarta `catalog.extended.json` y el cursor previo en `scratch/extend-catalog.state.json`.

