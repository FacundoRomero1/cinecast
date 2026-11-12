# Investigación: Endpoint `pollServers()` en TukiPlay (`pelixplay.js`)

Fuente analizada: `https://tukiplay.com/assets/pelixplay/pelixplay.js?v=1793428436` (53,938 bytes) y configuraciones reales de `window.PELIX_CONFIG` devueltas por `https://tukiplay.com/embed/movie/{tmdbId}` y `https://tukiplay.com/embed/tv/{tmdbId}/{season}/{episode}`.

> Nota: Documento solo de investigación. No implementa consumo directo del endpoint todavía.

---

## 1. Contexto de disparo (`init()` en `pelixplay.js`)

Al cargarse el HTML del embed, `pelixplay.js` lee `const CFG = window.PELIX_CONFIG || {}`. Si `CFG.langs` no tiene idiomas con servidores y `CFG.content?.pending` es `true`, `init()` llama a `await pollServers()` en lugar de mostrar `#unavailable-notice`:

- `POLL_MAX = 48` intentos
- `POLL_INTERVAL = 2500` ms (~120 segundos máximo de espera total)

Si `pollServers()` devuelve `true`, continúa la inicialización normal (`preferredLanguage`, `renderLangs`, `renderProviders`, `loadServer`). Si devuelve `false`, ejecuta `showUnavailableNotice()`.

---

## 2. Renovación previa de token (`freshToken()`)

Antes de cada iteración de `pollServers()`, llama a `await freshToken()`. Con `TOKEN_MAX_AGE = 45000` ms, si pasaron >= 45 s desde el último token, hace un `POST` previo a `CFG.edge`:

- **Método:** `POST`
- **URL:** `https://tukiplay.com/edge-data` (`CFG.edge = "/edge-data"`)
- **Headers / opciones:** `Content-Type: application/x-www-form-urlencoded; charset=UTF-8`, `credentials: "same-origin"`, `cache: "no-store"`
- **Body (`application/x-www-form-urlencoded`):**
  - `action=token`
  - `validtime=<token.validtime>`
  - `token=<token.token>`
- **Respuesta esperada:**
  ```json
  {
    "codigo": 200,
    "validtime": "<nuevo_token_validtime>",
    "token": "<nuevo_token>"
  }
  ```
  Si falla, `freshToken()` continúa usando el token inicial de `CFG.token`.

---

## 3. Endpoint usado por `pollServers()`

En cada ciclo (cada `2500` ms, timeout de request `20000` ms), `pollServers()` llama a `postEdge(...)`:

- **Método:** `POST`
- **URL:** `https://tukiplay.com/edge-data` (`CFG.edge`, relativo al origen `https://tukiplay.com`)
- **Content-Type:** `application/x-www-form-urlencoded; charset=UTF-8`
- **Credentials / Cache:** `same-origin` / `no-store` (requiere cookies/origen del embed si corresponde)
- **Body (`URLSearchParams`):**
  - `action`: `"servers"`
  - `id`: `String(CFG.content?.id || 0)` *(ID interno numérico de PelixPlay en `PELIX_CONFIG.content.id`, **no** el TMDB ID)*
  - `type`: `CFG.content?.type || "movie"` *(observado `"movie"` en películas y `"episode"` en episodios de TV/anime)*
  - `validtime`: `token.validtime`
  - `token`: `token.token`

---

## 4. Forma de la respuesta JSON

`postEdge()` elimina un posible BOM UTF-8 (`^\uFEFF`) y parsea JSON (`raw ? JSON.parse(raw) : null`). `pollServers()` inspecciona los siguientes campos:

1. **Estado todavía pendiente / error transitorio:**
   - `!res || res.codigo !== 200`: ignora y reintenta en el próximo tick (`2500` ms).
   - `res.codigo === 200` sin `res.total > 0` ni `res.empty`: sigue esperando el siguiente tick.

2. **Servidores disponibles (`res.total > 0 && res.servers`):**
   ```json
   {
     "codigo": 200,
     "total": 2,
     "servers": {
       "latino": {
         "name": "Latino",
         "logo": "https://flagcdn.com/w40/mx.png",
         "servers": [
           {
             "id": 968174,
             "link_name": "Videoapp",
             "server": "Videoapp",
             "logo": "/assets/images/server/server.svg",
             "color": "default",
             "link": "<payload_base64_cifrado>",
             "play": "",
             "picks": 0,
             "popular": 30
           }
         ]
       }
     }
   }
   ```
   `pollServers()` asigna `langs = res.servers` (la misma estructura de `CFG.langs` consumida por `langCodes()` y `serversOf(code)`) y retorna `true`.

3. **Sin servidores confirmados (`res.empty` truthy):**
   ```json
   {
     "codigo": 200,
     "total": 0,
     "empty": true
   }
   ```
   Corta el loop anticipadamente (`return false`) y muestra `#unavailable-notice`.

