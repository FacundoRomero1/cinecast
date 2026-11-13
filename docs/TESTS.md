# Documentación de Pruebas y Dependencias de Datos Locales

## 1. Visión General
Este documento detalla la suite completa de pruebas automatizadas del proyecto CineCast (`catalogo-escala`), sus dependencias de datos locales, precondiciones de ejecución y puertos requeridos.

---

## 2. Matriz de Dependencias por Prueba

| Prueba | Comando / Script | Tipo | Dependencias Locales / Precondiciones |
| :--- | :--- | :--- | :--- |
| **Typecheck Global** | `npx tsc --noEmit` | Estático | `tsconfig.json`, `src/**`. No requiere servidor ni datos en tiempo de ejecución. Excluye `legacy/**`. |
| **Lint Core Servidor** | `npm run lint:core` | Estático | `src/server/tsconfig.json`, `src/server/**`. |
| **Vite Client Build** | `npx vite build` | Compilación | `vite.config.ts`, `src/**`, `index.html`. Genera `dist/`. Excluye `legacy/**`. |
| **Build Core Electron**| `npm run build:core` | Compilación | `scripts/build-core.mjs`, compila `electron/core.cjs`. Requisito previo para scripts de API. |
| **verify-catalog-api** | `node scripts/verify-catalog-api.mjs` | Integración API | Requiere `electron/core.cjs`, `public/data/catalog.json`, `public/data/popularity.json`. Inicia servidor HTTP efímero en puerto dinámico (`:0`). |
| **verify-catalog-equivalence** | `node scripts/verify-catalog-equivalence.mjs` | Integración API | Requiere `electron/core.cjs`, `catalog.json`, SQLite en memoria. Compara 40 consultas entre motores memoria y SQLite, ETag, gzip, FTS5 y WebSocket. |
| **audit-filters** | `node scripts/audit-filters.mjs` | Integración API | Requiere `electron/core.cjs`, `catalog.json`. Audita filtros de catálogo, conteos de facetas y desempate determinista por ID. |
| **verify-home** | `node scripts/verify-home.mjs` | Integración API | Requiere `electron/core.cjs`, `catalog.json`. Verifica deduplicación estricta entre filas en `/api/home`, rotación diaria por semilla y umbrales de votos. |
| **probe-layout** | `node scripts/guard.cjs 60 -- npx electron scripts/probe-layout.cjs` | E2E Electron / CDP | Requiere Electron, servidor en puerto 3000 (lo auto-inicia si está libre), emulación CDP de viewport táctil 390x844. |
| **probe-dpad** | `node scripts/guard.cjs 60 -- npx electron scripts/probe-dpad.cjs` | E2E Electron / WS | Requiere Electron, servidor en puerto 3000, WebSockets. Valida secuencia D-Pad, conteo exacto de 20 toques, descarte de doble-toque <150ms y repetición sostenida tras 400ms. |
| **probe-spotify-device** | `node scripts/guard.cjs 60 -- npx electron scripts/probe-spotify-device.cjs` | E2E Electron | Requiere Electron, servidor en puerto 3000. Prueba endpoint OAuth, enmascaramiento de Client ID y controles en `#/musica`. |
| **probe-spotify-states** | `node scripts/guard.cjs 60 -- npx electron scripts/probe-spotify-states.cjs` | E2E Electron | Requiere Electron, servidor en puerto 3000. Prueba los 7 estados de Spotify, sección en Ajustes, desconexión y sanitización de logs. |
| **probe-sleep-timer** | `node scripts/guard.cjs 60 -- npx electron scripts/probe-sleep-timer.cjs` | E2E Electron | Requiere Electron, servidor en puerto 3000. Valida limpieza de "Más ajustes", switch único de Maratón, temporizador en `cinecast_sleep_timer_v1` y modal "¿Seguís ahí?". |
| **smoke-ui** | `node scripts/guard.cjs 60 -- npx electron scripts/smoke-ui.cjs` | E2E Electron | Requiere Electron, servidor en puerto 3000. Smoke test general de rutas principales del cliente. |
| **e2e-touch** | `node scripts/guard.cjs 150 -- npx electron scripts/e2e-touch.cjs` | E2E Electron / Touch | Requiere Electron, servidor en puerto 3000. Valida interacciones táctiles complejas, drag, switches y controles móviles. |

---

## 3. Protocolo de Ejecución en Limpio
Para aislar estados locales, sesiones residuales o bloqueos de puertos:
1. **Limpieza previa de procesos**: ejecutar `node scripts/cleanup.cjs` antes de cada corrida.
2. **Puertos**: asegurar que el puerto 3000 esté liberado. Los scripts con servidor embebido lo inician automáticamente con `CINECAST_TEST=1` y `CINECAST_DISABLE_PREWARM=1`.
3. **Persistencia local**: las pruebas que evalúan estados iniciales limpian explícitamente `localStorage` y `.cinecast-data/cinecast-accounts.json`.
4. **Timeouts y supervisión**: todo proceso Electron se ejecuta bajo `scripts/guard.cjs` con límite de tiempo estricto y recolección de logs en `scratch/logs/`.
