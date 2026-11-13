# Documentación de Componentes Legacy (Vista Clásica)

## 1. Resumen y Motivo del Traslado
En el marco de la consolidación de la arquitectura de CineCast y el despliegue del catálogo escalable (rama `catalogo-escala`), la interfaz clásica monolítica ha sido retirada del empaquetado principal activo y archivada en `legacy/`.

Se preservó el 100% del código y del historial mediante operaciones de `git mv`, manteniendo intactas las estructuras y subcarpetas originales. La aplicación ahora monta exclusivamente la nueva interfaz unificada (`src/ui/NewApp.tsx` junto con `src/app/AppRuntime.tsx`), eliminando la bifurcación condicional en `src/main.tsx` y el flag `cinecast_ui_v2`.

---

## 2. Inventario de Archivos Archivados en `legacy/`

Todos los archivos exclusivos de la vista clásica se encuentran en:
- `legacy/src/App.tsx`: Contenedor principal de la UI clásica.
- `legacy/src/components/Navbar.tsx`: Barra de navegación superior clásica.
- `legacy/src/components/HeroBanner.tsx`: Banner hero clásico.
- `legacy/src/components/Hero.tsx`: Re-exportador de HeroBanner.
- `legacy/src/components/DualScreenSimulator.tsx`: Simulador flotante de pantalla dual.
- `legacy/src/components/ContinueWatchingRow.tsx`: Fila clásica de continuar viendo.
- `legacy/src/components/MovieRow.tsx`: Fila horizontal de tarjetas.
- `legacy/src/components/MovieGrid.tsx`: Cuadrícula clásica de películas.
- `legacy/src/components/MovieCard.tsx`: Tarjeta clásica de título.
- `legacy/src/components/CategoryFilter.tsx`: Selector clásico de categorías.
- `legacy/src/components/CustomStreamModal.tsx`: Modal clásico para añadir streaming manual.
- `legacy/src/components/RemoteTouchpad.tsx`: Versión temprana del trackpad.
- `legacy/src/components/PWAInstallButton.tsx`: Botón clásico de instalación PWA.

---

## 3. Configuración de Exclusión
Para evitar sobrecarga en los tiempos de compilación, análisis estático y empaquetado de producción, la carpeta `legacy/` fue excluida explícitamente en:
- `tsconfig.json`: Entrada `"legacy"` dentro del array `"exclude"`.
- `vite.config.ts`: `rollupOptions.external` y `server.watch.ignored`.
- `scripts/verify-runtime-copy.mjs`: Actualizado para resolver `legacy/src/App.tsx` en caso de que `src/App.tsx` no esté presente en la raíz.

---

## 4. Instrucciones de Restauración

Si en el futuro se desea restaurar temporalmente la vista clásica para propósitos de comparación o depuración:

### Opción A: Restauración mediante Git (Recomendada)
Para devolver los archivos a su ubicación original en `src/`:
```bash
git mv legacy/src/App.tsx src/App.tsx
git mv legacy/src/components/* src/components/
```

### Opción B: Montaje manual en `src/main.tsx`
1. Reincorporar `src/App.tsx` o importarlo desde `../legacy/src/App.tsx`.
2. Remover `"legacy"` de `tsconfig.json` (`exclude`).
3. En `src/main.tsx`, renderizar `<App />` en lugar de `<NewApp />`.

---

## 5. Verificación de Integridad
El script de verificación de equivalencia sigue disponible y verifica que ningún caso de comando remoto, llamada a `deviceSync` o API de Electron de la vista clásica haya quedado fuera de `AppRuntime.tsx`:
```bash
node scripts/verify-runtime-copy.mjs
```
Resultado: **0 casos faltantes, 0 llamadas a deviceSync faltantes, 0 llamadas a electronAPI faltantes**.

