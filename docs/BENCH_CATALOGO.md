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
