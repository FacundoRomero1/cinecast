# CineCast TV

Centro multimedia de entretenimiento integral para Smart TV y PC: Catálogo masivo (10.000+ títulos), TV en Vivo (IPTV HLS verificado), Anime en Audio Latino verificado, YouTube TV oficial y Spotify Web Player.

---

## 📺 Integración de Spotify y Reproducción de Audio Protegido (DRM Widevine)

El Web Player oficial de Spotify (`https://open.spotify.com`) requiere el módulo de descifrado de contenido **Widevine CDM** de Google para reproducir pistas con protección de derechos de autor (DRM). 

Debido a licencias propietarias de Google, las compilaciones estándar de código abierto de Electron no incluyen Widevine CDM empaquetado por defecto. Si una pista no emite sonido en el reproductor embebido, existen dos soluciones oficiales:

### Salida 1: Migrar a `castlabs-electron` (Recomendado para distribución nativa)
[castLabs Electron for Content Protection](https://github.com/castlabs/electron-releases) es un fork verificado de Electron que incluye la integración oficial de Google Widevine CDM con VMP (Verified Media Path) para Windows, macOS y Linux.
- Reemplazar en `package.json`:
  ```bash
  npm uninstall electron
  npm install --save-dev @castlabs/electron
  ```
- No requiere cambios en la base de código. Habilita de inmediato la reproducción directa de streams protegidos por DRM dentro del `<webview>`.

### Salida 2: Botón de Salto "Abrir en navegador externo" (Fallback integrado)
CineCast TV incluye un botón directo en el encabezado del Web Player de Spotify (`[Abrir en navegador]`) que lanza `https://open.spotify.com` en el navegador predeterminado del sistema (Google Chrome, Microsoft Edge o Firefox), los cuales ya tienen Widevine CDM licenciado y habilitado por defecto.

---

## 🚀 Ejecución y Compilación

1. **Instalación de dependencias:**
   ```bash
   npm install
   ```
2. **Modo Desarrollo (Servidor + Electron):**
   ```bash
   npm run dev
   # En otra terminal:
   npm run electron
   ```
3. **Compilación de producción:**
   ```bash
   npm run build
   ```
