# Benchmark de Catálogo — Línea Base y Evolución (`catalogo-escala`)

## 1. Línea Base — Servidor (`scripts/bench-catalog.cjs`)

Archivo real: `public/data/catalog.json` → **21,565,714 bytes (20.57 MiB)**, **10,119 ítems**.  
Entorno: Node `v26.13.0` (`--expose-gc`), 200 llamadas por endpoint (100 `Accept-Encoding: identity` + 100 `Accept-Encoding: gzip`).  
Nota metodológica: en `/api/search?q=ba`, el harness de benchmark cachea en memoria las respuestas externas de TMDB/Google Suggest tras la primera llamada para medir exclusivamente el costo del servidor local; el servidor actual no monta `compression`, por lo que `Accept-Encoding: gzip` devuelve `Content-Encoding: identity` (idéntico en bytes).

### Carga en memoria y footprint (tras `global.gc()`)

| Escenario | Ítems | Tamaño JSON | Carga (ms) | `heapUsed` tras GC | `RSS` tras GC |
| --- | ---: | ---: | ---: | ---: | ---: |
| `real-10119` | 10,119 | 20.57 MiB | 146.24 | 36.58 MiB | 100.52 MiB |
| `50k` (sintético en `scratch/`) | 50,000 | 81.25 MiB | 628.55 | 135.71 MiB | 270.30 MiB |
| `100k` (sintético en `scratch/`) | 100,000 | 162.58 MiB | 1712.44 | 260.07 MiB | 407.40 MiB |

### Latencia y bytes por endpoint (200 llamadas c/u)

| Escenario | Endpoint | Sin gzip `p50 / p95` (ms) | Bytes sin gzip | Con `Accept-Encoding: gzip` `p50 / p95` (ms) | Bytes wire (`Content-Encoding`) |
| --- | --- | ---: | ---: | ---: | ---: |
| `real-10119` | `/api/catalog?limit=40&fields=card` | 0.50 / 0.78 | 14,821 | 0.45 / 0.67 | 14,821 (`identity`) |
| `real-10119` | `/api/home` | 9.88 / 16.27 | 69,780 | 8.83 / 14.21 | 69,780 (`identity`) |
| `real-10119` | `/api/search?q=ba` | 31.70 / 37.18 | 76,003 | 31.93 / 46.15 | 76,003 (`identity`) |
| `real-10119` | `/api/genres` | 1.11 / 3.21 | 556 | 1.00 / 1.72 | 556 (`identity`) |
| `50k` | `/api/catalog?limit=40&fields=card` | 1.55 / 2.55 | 15,385 | 1.46 / 2.32 | 15,385 (`identity`) |
| `50k` | `/api/home` | 61.19 / 143.58 | 73,714 | 58.29 / 65.29 | 73,714 (`identity`) |
| `50k` | `/api/search?q=ba` | 148.08 / 163.68 | 76,119 | 145.59 / 164.24 | 76,119 (`identity`) |
| `50k` | `/api/genres` | 7.89 / 9.87 | 564 | 7.76 / 8.46 | 564 (`identity`) |
| `100k` | `/api/catalog?limit=40&fields=card` | 3.04 / 4.81 | 15,425 | 3.28 / 5.69 | 15,425 (`identity`) |
| `100k` | `/api/home` | 127.36 / 183.81 | 72,435 | 127.20 / 158.20 | 72,435 (`identity`) |
| `100k` | `/api/search?q=ba` | 295.39 / 329.71 | 76,127 | 302.68 / 325.26 | 76,127 (`identity`) |
| `100k` | `/api/genres` | 19.32 / 21.52 | 572 | 18.53 / 25.60 | 572 (`identity`) |

---

## 2. Línea Base — Cliente Electron (`scripts/bench-client.cjs`)

Configuración: Electron `BrowserWindow` 390×844 (`deviceScaleFactor: 2`, `mobile: true`), URL LAN `http://192.168.18.39:3000/?ui=nuevo`, CPU throttling `4x` vía CDP, caché de red deshabilitada, 30 pasos de scroll de pantalla completa (`844 px` c/u).

| Ruta | Nodos DOM (`*`) | Cantidad `<img>` | `usedJSHeapSize` | Reqs `/api/poster` | Bytes `/api/poster` | `scrollY / scrollHeight` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `#/explorar` | 759 | 8 | 49,938,238 (47.62 MiB) | 0 | 0 (0.00 MiB) | 25,320 / 32,028 |
| `#/` (Inicio) | 5,015 | 196 | 79,563,512 (75.88 MiB) | 0 | 0 (0.00 MiB) | 3,334 / 4,178 |

**Hallazgos clave de línea base**:
1. En `#/` (Inicio) no hay virtualización de filas: se montan **5,015 nodos DOM** y **196 `<img>`** de golpe (~75.88 MiB de heap JS vs 47.62 MiB en `#/explorar`).
2. `TitleCard.tsx` hoy apunta directo a `item.posterUrl` externo sin pasar por `/api/poster` (por eso `/api/poster` transfiere `0` bytes en línea base).
3. En el servidor, `loadServerCatalogFromDisk()` carga todo `catalog.json` a un array en RAM (`260 MiB` heap / `407 MiB` RSS en 100k) y `/api/search` hace escaneo lineal O(N) (`p95 ~330 ms` en 100k).

---

## 3. Parte 2 — Servidor SQLite + FTS5 + `compression` + ETag (`scripts/bench-catalog.cjs`)

Implementación:
- `src/server/core/catalogSchema.ts` + `src/server/core/catalogDb.ts`: `node:sqlite` (`DatabaseSync`), tabla `items` con índices compuestos (`upcoming`, `category`, `year`, `rating`, `added_at_ms`, `title_rank`), tabla `item_genres`, resúmenes precomputados (`genres_summary`, `available_genres_summary`), tabla virtual `items_fts` con `tokenize='unicode61 remove_diacritics 2'` para `/api/search`, y verificación SHA-256 en `meta` con reconstrucción automática.
- Middleware `compression()` en `src/server/core/http.ts` y `Cache-Control: public, max-age=60` + `ETag` (`304`) en `/api/catalog`, `/api/genres` y `/api/home`.
- Fallback completo en memoria vía `CINECAST_CATALOG_ENGINE=memory` (equivalencia verificada 40/40 en `scripts/verify-catalog-equivalence.mjs`).

### Apertura cálida en SQLite y footprint JS (tras `global.gc()`)

| Escenario | Ítems | JSON MiB | Build DB (ms) | Apertura cálida (ms) | `heapUsed` tras GC | `RSS` tras GC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `real-10119` | 10,119 | 20.57 MiB | 1,272.81 | 18.21 | 12.07 MiB | 136.59 MiB |
| `50k` (sintético) | 50,000 | 81.25 MiB | 7,388.89 | 61.44 | 11.88 MiB | 187.60 MiB |
| `100k` (sintético) | 100,000 | 162.58 MiB | 20,502.25 | 124.85 | 11.89 MiB | 410.10 MiB |

### Latencia y bytes por endpoint tras Parte 2 (200 llamadas c/u)

| Escenario | Endpoint | Sin gzip `p50 / p95` (ms) | Bytes sin gzip | Gzip `p50 / p95` (ms) | Bytes wire (`Content-Encoding`) |
| --- | --- | ---: | ---: | ---: | ---: |
| `real-10119` | `/api/catalog?limit=40&fields=card` | 0.82 / 1.29 | 14,821 | 1.00 / 1.31 | 3,581 (`gzip`) |
| `real-10119` | `/api/home` | 3.29 / 7.66 | 69,780 | 3.03 / 5.94 | 9,735 (`gzip`) |
| `real-10119` | `/api/search?q=ba` | 2.65 / 4.86 | 91,241 | 4.34 / 5.55 | 15,990 (`gzip`) |
| `real-10119` | `/api/genres` | 0.52 / 0.74 | 556 | 0.47 / 0.58 | 556 (`identity`) |
| `50k` | `/api/catalog?limit=40&fields=card` | 1.08 / 1.64 | 15,385 | 1.46 / 2.48 | 3,674 (`gzip`) |
| `50k` | `/api/home` | 2.49 / 4.68 | 73,714 | 2.74 / 3.97 | 4,782 (`gzip`) |
| `50k` | `/api/search?q=ba` | 12.97 / 18.32 | 95,353 | 14.54 / 18.99 | 7,097 (`gzip`) |
| `50k` | `/api/genres` | 0.39 / 0.54 | 564 | 0.47 / 0.68 | 564 (`identity`) |
| `100k` | `/api/catalog?limit=40&fields=card` | 0.83 / 1.49 | 15,425 | 1.17 / 1.91 | 3,675 (`gzip`) |
| `100k` | `/api/home` | 2.27 / 4.61 | 72,435 | 2.81 / 3.58 | 4,153 (`gzip`) |
| `100k` | `/api/search?q=ba` | 23.01 / 25.36 | 90,951 | 23.20 / 27.95 | 6,906 (`gzip`) |
| `100k` | `/api/genres` | 0.40 / 0.55 | 572 | 0.38 / 0.51 | 572 (`identity`) |

**Mejoras medidas en Parte 2 (vs línea base en 100k)**:
- `heapUsed` en Node bajó de **260.07 MiB → 11.89 MiB** (−95.4%).
- `/api/home` bajó de **127.36 ms (`p50`) → 2.27 ms** (−98.2%) y de **72,435 B → 4,153 B** con gzip (−94.3%).
- `/api/search?q=ba` bajó de **295.39 ms (`p50`) → 23.01 ms** (−92.2%).
- `/api/catalog?limit=40&fields=card` bajó de **3.04 ms → 0.83 ms** y **15,425 B → 3,675 B** con gzip (−76.2%).

---

## 4. Parte 4 — Cliente liviano, proxy `/api/poster` por ancho y Modo Lite (`scripts/bench-client.cjs`)

Implementación:
- Servidor `/api/poster` (`src/server/core/routes/catalog.ts`): parámetro `w` (`154 | 185 | 342`, default `185`), reescritura de ancho TMDB (`/t/p/w.../`), clave de caché por `(w, url)`, actualización de `atime` en hit y poda LRU en disco controlada por `CINECAST_POSTER_CACHE_MB` (default `500 MiB`).
- Cliente (`src/ui/liteMode.ts`, `TitleCard.tsx`, `Hero.tsx`, `Row.tsx`, `NewApp.tsx`, `tokens.css`, `localCatalogProvider.ts`):
  - Pósters con `loading="lazy"`, `decoding="async"`, placeholder 2:3 (`.cc-poster-placeholder`) y URL `/api/poster?url=...&w=154|185|342`.
  - Inicio (`HomeView`): virtualización vertical de filas con `<Virtuoso useWindowScroll>` (`overscan` 200 / 100 en Lite) + ventaneo horizontal inicial por fila (10 tarjetas, 8 en Lite, expansión progresiva de +10 al desplazarse o avanzar).
  - Explorar (`ExploreView`): `AbortController` por consulta/página, caché LRU de 6 páginas en `LocalCatalogProvider`, tope de **600 ítems** en DOM con aviso de acotar filtros y `overscan` 200 / 100 en Lite.
  - Modo Lite (`?lite=1|0`, selector en Ajustes `Auto | Activado | Desactivado`, autodetección para TV / baja RAM / `prefers-reduced-motion`): desactiva transiciones, animaciones, `backdrop-filter` y sombras (`.cc-lite`), usa `w=154` en grillas/filas y reduce `overscan` e ítems iniciales por fila.

### Comparativa Cliente Electron 390×844 CPU 4x (Línea Base vs Parte 4 Normal vs Parte 4 Lite)

| Ruta | Escenario | Nodos DOM (`*`) | Cantidad `<img>` | `usedJSHeapSize` | Reqs `/api/poster` | Bytes `/api/poster` | `scrollY / scrollHeight` |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `#/explorar` | Línea Base | 759 | 8 | 49,938,238 (47.62 MiB) | 0 | 0 (0.00 MiB) | 25,320 / 32,028 |
| `#/explorar` | Parte 4 Normal | 762 | 8 | 64,480,528 (61.49 MiB) | 158 | 2,232,386 (2.13 MiB) | 25,320 / 32,028 |
| `#/explorar` | Parte 4 Lite (`?lite=1`) | 762 | 8 | 64,570,984 (61.58 MiB) | 160 | 2,263,705 (2.16 MiB) | 25,320 / 32,028 |
| `#/` (Inicio) | Línea Base | 5,015 | 196 | 79,563,512 (75.88 MiB) | 0 | 0 (0.00 MiB) | 3,334 / 4,178 |
| `#/` (Inicio) | Parte 4 Normal | 1,367 | 40 | 81,195,175 (77.43 MiB) | 31 | 497,098 (0.47 MiB) | 3,235 / 4,079 |
| `#/` (Inicio) | Parte 4 Lite (`?lite=1`) | 1,367 | 40 | 54,191,473 (51.68 MiB) | 31 | 496,476 (0.47 MiB) | 3,196 / 4,040 |

**Hallazgos medidos en Parte 4**:
- En `#/` (Inicio), la virtualización de filas + ventaneo horizontal redujo los nodos DOM de **5,015 → 1,367** (**−72.7%**) y los elementos `<img>` de **196 → 40** (**−79.6%**).
- En `#/` con **Modo Lite (`?lite=1`)**, `usedJSHeapSize` bajó de **75.88 MiB (base) / 77.43 MiB (normal) → 51.68 MiB** (**−31.9%** respecto a la línea base).
- En `#/explorar`, los pósters pasaron de cargarse sin proxy (`0` reqs locales) a servirse cacheados vía `/api/poster` (`w=185` / `w=154`, ~14 KB promedio por póster).

---

## 5. Parte 5 — Catálogo extendido (`scripts/extend-catalog.mjs --limit 2000`)

Prueba ejecutada generando `public/data/catalog.extended.json` (**2,000** ítems nuevos, **3.11 MiB**) sin modificar `public/data/catalog.json` (**10,119** ítems, **20.57 MiB**), combinando **12,119** ítems totales en `data/catalog.sqlite` (`49,577,984` bytes):

- Build inicial de `data/catalog.sqlite` combinado: **1,510.41 ms**.
- Apertura cálida SQLite (`real-12119`): **20.93 ms**, `heapUsed` tras GC **11.93 MiB**, `RSS` **150.59 MiB**.

| Endpoint (`real-12119`, 200 llamadas c/u) | Sin gzip `p50 / p95` (ms) | Bytes sin gzip | Gzip `p50 / p95` (ms) | Bytes wire (`Content-Encoding`) |
| --- | ---: | ---: | ---: | ---: |
| `/api/catalog?limit=40&fields=card` | 1.03 / 2.28 | 14,821 | 1.34 / 1.96 | 3,581 (`gzip`) |
| `/api/home` | 2.63 / 4.82 | 69,780 | 3.09 / 4.14 | 9,735 (`gzip`) |
| `/api/search?q=ba` | 4.47 / 6.36 | 91,241 | 3.21 / 4.49 | 15,990 (`gzip`) |
| `/api/genres` | 0.39 / 0.54 | 558 | 0.39 / 0.53 | 558 (`identity`) |
