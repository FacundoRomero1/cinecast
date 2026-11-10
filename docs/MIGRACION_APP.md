# Inventario de `src/App.tsx` para la Migración de la UI

---

## a. Cuadro de responsabilidades de `src/App.tsx`

| Bloque | Líneas (`src/App.tsx`) | Estados (`useState` / `useRef`) | Efectos (`useEffect` + dependencia clave) | Handlers / Funciones | Servicios que usa |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OAuth y Salud de Proveedores** | `32–46` | *(ninguno propio; usa `triggerNotification`)* | `33–39`: procesa redirect OAuth (`[]`)<br>`42–46`: refresca salud de embeds cada 3 h (`[]`) | *(inline en `useEffect`)* | `authService.handleRedirectCallback`, `refreshProviderHealth` (`embedService`) |
| **Sincronización de dispositivos y roles (`screen` / `remote` / `hybrid`)** | `48–64`, `236–301`, `371–382`, `1098–1110` | `deviceRole` (`48`)<br>`roomId` (`49`)<br>`devices` (`50`)<br>`selectedScreenId` (`51`)<br>`homeRoomId` (`54`)<br>`isGuestMode` (`60`)<br>`virtualCursor` (`237`)<br>`virtualCursorTimeoutRef` (`238`) | `240–250`: cursor virtual Electron (`[]`)<br>`253–260`: WakeLock en móvil (`[deviceRole]`)<br>`263–301`: conexión a sala y alta de dispositivos (`[homeRoomId, isScreenInStandby, deviceRole]`) | `handleTogglePermanentHome` (`371–382`) | `deviceSync`, `window.electronAPI.onVirtualCursorPosition` |
| **Comandos remotos (recepción y envío)** | `212–234`, `303–332`, `343–369`, `385–838`, `921–926` | `lastRemoteCommand` (`213`)<br>`remotePlaybackState` (`216`)<br>`remoteNotification` (`154`)<br>`remoteCmdHandlerRef` (`304`) | `307–332`: suscripción a `onCommand` y `onStateSync` (`[]`) | `triggerNotification` (`344–349`)<br>`playSignalChime` (`352–369`)<br>`handleRemoteCommandReceived` (`385–836`)<br>`sendRemoteCommand` (`921–926`) | `deviceSync`, `generateServersForMedia`, `window.electronAPI` (`focusWindow`, `sendNativeKey`, `controlActiveMedia`, `setMasterVolume`, `sendNativeTrackpadEvent`) |
| **Estado de reposo (Standby / AmbientScreen)** | `152–154`, `273–288`, `390`, `754–769`, `1132–1157` | `isScreenInStandby` (`153`) | Despertar automático en `273–288` (`[homeRoomId, isScreenInStandby, deviceRole]`) | Cases `'setStandby'` (`754`) y `'wakeScreen'` (`760`) en `handleRemoteCommandReceived` | `deviceSync` |
| **Reproducción local y enviar a pantalla (Cast)** | `174–178`, `840–1064`, `1158–1188` | `activeMedia` (`175`)<br>`activeEpisode` (`176`)<br>`isPlayingLocally` (`177`)<br>`playerInitialTime` (`178`) | `1039–1044`: broadcast al cambiar estado (`[deviceRole, isScreenInStandby, isPlayingLocally, isSpotifyPlaying, isYouTubePlaying, activeHub, activeMedia?.id, activeEpisode?.id, audioSettings]`)<br>`1047–1064`: polling cada 2 s de `getRealMediaState` (`[deviceRole, isPlayingLocally, activeHub, activeSpotifyTrack, activeYouTubeVideo, activeMedia, handleBroadcastPlayerState]`) | `handlePlayNextEpisode` (`841–879`)<br>`handlePlayPrevEpisode` (`881–918`)<br>`handleCastMediaToScreen` (`929–957`)<br>`handlePlayLocal` (`960–998`)<br>`handleBroadcastPlayerState` (`1001–1036`) | `deviceSync`, `window.electronAPI.getRealMediaState` |
| **Historial de visualización (`Continuar Viendo`)** | `179–202`, `1505–1523` | `continueWatchingList` (`179`) | `188–202`: sync con servidor y suscripción local/remota (`[refreshContinueWatching]`) | `refreshContinueWatching` (`183–185`) | `watchHistoryService`, `deviceSync.onWatchHistory` |
| **Ajustes de audio y de reproducción** | `157–172`, `721–749`, `1675–1694` | `audioSettings` (`157`)<br>`playbackSettings` (`168`) | Sincronizados en `320–325` y emitidos en `1039–1044` | Callbacks `onUpdateAudio` y `onUpdatePlayback` (`1168`, `1680`, `1687`, `1740`, `1741`) | `deviceSync`, `window.electronAPI.setMasterVolume` |
| **Mi lista (Favoritos)** | `143–150`, `335–341`, `1583–1594` | `myListIds` (`143`) | *(ninguno; lectura inicial lazy en `useState`)* | `toggleMyList` (`335–341`) | `localStorage` (`cinecast_my_list`) |
| **Catálogo y búsqueda** | `76–135`, `1067–1097`, `1303–1642` | `currentCategory` (`76`)<br>`searchQuery` (`77`)<br>`globalSearchResults` (`78`)<br>`isGlobalSearching` (`79`)<br>`suggestedTypo` (`80`) | `83–135`: debounce 300 ms contra `/api/search?q=` (`[searchQuery]`) | Búsqueda profunda manual en `/api/search?q=...&tmdb=true` (`1328–1365`, `1446–1483`) | `fetch('/api/search')`, `MEDIA_CATALOG`, `createStyledPosterFallback` |
| **Hubs (`cinecast` / `spotify` / `youtube`)** | `66–73`, `205–210`, `575–676`, `1219–1302` | `activeHub` (`66`)<br>`activeSpotifyTrack` (`205`)<br>`isSpotifyPlaying` (`206`)<br>`activeYouTubeVideo` (`209`)<br>`isYouTubePlaying` (`210`) | Incluidos en broadcast (`1039–1044`) y polling (`1047–1064`) | Callbacks de `SpotifyHub` (`1226–1256`) y `YouTubeHub` (`1267–1300`) | `SPOTIFY_TRACKS`, `YOUTUBE_VIDEOS`, `deviceSync` |
| **Modales** | `137–141`, `1646–1746` | `selectedMediaForDetails` (`137`)<br>`isAudioModalOpen` (`138`)<br>`isCastModalOpen` (`139`)<br>`isGuestModalOpen` (`140`)<br>`isDualSimulatorOpen` (`141`) | *(controlados por apertura/cierre de usuario)* | Setters `setSelectedMediaForDetails`, `setIsAudioModalOpen`, `setIsCastModalOpen`, `setIsGuestModalOpen`, `setIsDualSimulatorOpen` | *(pasan props a cada modal)* |

---

## b. Cómo se decide el rol del dispositivo (`deviceRole`) y qué muestra `App.tsx`

### Origen de `deviceRole`
1. **Inicialización en `deviceSync.initDeviceId()` ([`src/services/deviceSync.ts:134-152`](file:///C:/PROYECTOS/cinecast/cinecast/src/services/deviceSync.ts#L134-L152))**:
   - Lee `const roleFromUrl = params.get('role')` de `window.location.search` (línea 134) y evalúa `const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)` (línea 135).
   - Regla de decisión (líneas 137–149):
     - Si `roleFromUrl === 'remote'` -> `this.deviceType = 'remote'`.
     - Si `roleFromUrl === 'screen'` -> `this.deviceType = 'screen'`.
     - Si no viene `?role=` y `isMobileUA === true` -> `this.deviceType = 'remote'`.
     - En cualquier otro caso -> `this.deviceType = 'screen'`.
   - Guarda el valor en `localStorage.setItem('cinecast_device_type', this.deviceType)` (línea 151), aunque en el siguiente arranque vuelve a calcularse según `?role=` y `navigator.userAgent` (no lee `cinecast_device_type` en `initDeviceId`).
2. **Estado en `App.tsx` ([`src/App.tsx:48`](file:///C:/PROYECTOS/cinecast/cinecast/src/App.tsx#L48))**:
   - `const [deviceRole, setDeviceRole] = useState<DeviceType>(deviceSync.getDeviceType());`
   - Puede cambiarse manualmente en caliente desde:
     - El botón `"Cambiar a Modo Celular"` en la pantalla de reposo ([`src/App.tsx:1147-1150`](file:///C:/PROYECTOS/cinecast/cinecast/src/App.tsx#L1147-L1150)).
     - El selector de rol en `Navbar` (`onChangeDeviceRole`, [`src/App.tsx:1204-1208`](file:///C:/PROYECTOS/cinecast/cinecast/src/App.tsx#L1204-L1208)).
     - El modal `CastModal` (`onChangeDeviceType`, [`src/App.tsx:1713-1717`](file:///C:/PROYECTOS/cinecast/cinecast/src/App.tsx#L1713-L1717)).

### Qué muestra y hace `App.tsx` según `deviceRole`
- **`deviceRole === 'screen'` (PC / TV)**:
  - Si `isScreenInStandby === true` ([`src/App.tsx:1132-1157`](file:///C:/PROYECTOS/cinecast/cinecast/src/App.tsx#L1132-L1157)): renderiza `<AmbientScreen>` con reloj, PIN de sala y código QR.
  - Si `isPlayingLocally && activeMedia && activeHub === 'cinecast'` ([`src/App.tsx:1158-1188`](file:///C:/PROYECTOS/cinecast/cinecast/src/App.tsx#L1158-L1188)): renderiza `<VideoPlayer>` a pantalla completa.
  - Si no está en reposo ni reproduciendo película local ([`src/App.tsx:1190-1643`](file:///C:/PROYECTOS/cinecast/cinecast/src/App.tsx#L1190-L1643)): renderiza `<Navbar>` y el contenido del hub activo (`<SpotifyHub>`, `<YouTubeHub>`, resultados de búsqueda o `<HeroBanner>` + `<ContinueWatchingRow>` + `<MovieGrid>` + `<MovieRow>`).
  - Ejecuta todos los comandos entrantes en `handleRemoteCommandReceived` ([`src/App.tsx:387`](file:///C:/PROYECTOS/cinecast/cinecast/src/App.tsx#L387)), emite `broadcastPlaybackState` (`1002`, `1040`) y ejecuta el polling de `getRealMediaState` cada 2 s (`1048`).
  - **No** renderiza `<RemoteControlDrawer>`.
- **`deviceRole === 'remote'` (Celular / Control remoto)**:
  - Nunca muestra `<AmbientScreen>` ni abre `<VideoPlayer>` local al pulsar reproducir: `handlePlayLocal` ([`src/App.tsx:961-963`](file:///C:/PROYECTOS/cinecast/cinecast/src/App.tsx#L961-L963)) redirige automáticamente a `handleCastMediaToScreen`, que envía el comando `playDiscoveredMovie` a la pantalla PC.
  - Renderiza el catálogo/hubs con `<Navbar>` y agrega fijo en la parte inferior `<RemoteControlDrawer>` ([`src/App.tsx:1646-1657`](file:///C:/PROYECTOS/cinecast/cinecast/src/App.tsx#L1646-L1657)).
  - Solicita `deviceSync.requestWakeLock()` ([`src/App.tsx:254-255`](file:///C:/PROYECTOS/cinecast/cinecast/src/App.tsx#L254-L255)) e ignora la ejecución local de comandos remotos (`if (deviceRole === 'remote') return;` en [`src/App.tsx:387`](file:///C:/PROYECTOS/cinecast/cinecast/src/App.tsx#L387)).
- **`deviceRole === 'hybrid'`**:
  - Comparte la vista de catálogo/reproductor local (`deviceRole !== 'remote'`), ejecuta comandos recibidos y polling de estado (`1048`), pero no entra en `<AmbientScreen>` (`isScreenInStandby && deviceRole === 'screen'`) ni emite en `handleBroadcastPlayerState` (`if (deviceRole === 'screen')` en `1002`) ni muestra `<RemoteControlDrawer>`.

---

## c. Interfaces de props (copiadas literales)

### 1. `VideoPlayerProps` ([`src/components/VideoPlayer.tsx:15-30`](file:///C:/PROYECTOS/cinecast/cinecast/src/components/VideoPlayer.tsx#L15-L30))
```ts
interface VideoPlayerProps {
  media: MediaItem;
  episode: Episode | null;
  audioSettings: AudioSettings;
  playbackSettings: PlaybackSettings;
  onUpdateAudio: (settings: Partial<AudioSettings>) => void;
  onClose: () => void;
  onNextEpisode?: () => void;
  onPrevEpisode?: () => void;
  hasNextEpisode?: boolean;
  onBroadcastState?: (stateUpdate: any) => void;
  remoteCommandNotification?: string | null;
  onOpenAudioSettings?: () => void;
  remoteCommandTrigger?: { cmd: RemoteCommand; timestamp: number } | null;
  initialTime?: number;
}
```

### 2. `DetailModalProps` ([`src/components/DetailModal.tsx:41-51`](file:///C:/PROYECTOS/cinecast/cinecast/src/components/DetailModal.tsx#L41-L51))
```ts
interface DetailModalProps {
  media: MediaItem | null;
  onClose: () => void;
  onPlayLocal: (media: MediaItem, episode?: Episode) => void;
  onCastToScreen: (media: MediaItem, episode?: Episode) => void;
  connectedScreenName?: string;
  isMyList: boolean;
  onToggleMyList: (mediaId: string) => void;
  allCatalog?: MediaItem[];
  onSelectSimilar?: (item: MediaItem) => void;
}
```

### 3. `RemoteControlDrawerProps` ([`src/components/RemoteControlDrawer.tsx:28-37`](file:///C:/PROYECTOS/cinecast/cinecast/src/components/RemoteControlDrawer.tsx#L28-L37))
```ts
interface RemoteControlDrawerProps {
  playbackState?: PlaybackState;
  currentMedia?: MediaItem | null;
  currentEpisode?: Episode | null;
  connectedScreenName?: string;
  onSendCommand?: (command: RemoteCommand) => void;
  onOpenAudioModal?: () => void;
  onOpenCastModal?: () => void;
  onOpenGuestModal?: () => void;
}
```

### 4. `RemoteControlSheetProps` ([`src/components/RemoteControlSheet.tsx:33-42`](file:///C:/PROYECTOS/cinecast/cinecast/src/components/RemoteControlSheet.tsx#L33-L42))
```ts
interface RemoteControlSheetProps {
  playbackState: PlaybackState;
  currentMedia: MediaItem | null;
  currentEpisode: Episode | null;
  connectedScreenName: string;
  onSendCommand: (command: RemoteCommand) => void;
  onOpenAudioModal: () => void;
  onOpenCastModal: () => void;
  onOpenGuestModal?: () => void;
}
```

### 5. `CastModalProps` ([`src/components/CastModal.tsx:7-21`](file:///C:/PROYECTOS/cinecast/cinecast/src/components/CastModal.tsx#L7-L21))
```ts
interface CastModalProps {
  isOpen: boolean;
  onClose: () => void;
  devices: DeviceInfo[];
  currentDeviceId: string;
  currentRoomId: string;
  currentDeviceType: DeviceType;
  selectedScreenId: string | null;
  onSelectScreen: (deviceId: string) => void;
  onChangeRoom: (newRoomId: string) => void;
  onChangeDeviceType: (type: DeviceType) => void;
  onOpenDualSimulator: () => void;
  isPermanentHome: boolean;
  onTogglePermanentHome: () => void;
}
```

### 6. `AudioSettingsModalProps` ([`src/components/AudioSettingsModal.tsx:5-13`](file:///C:/PROYECTOS/cinecast/cinecast/src/components/AudioSettingsModal.tsx#L5-L13))
```ts
interface AudioSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioSettings: AudioSettings;
  playbackSettings: PlaybackSettings;
  onUpdateAudio: (settings: Partial<AudioSettings>) => void;
  onUpdatePlayback: (settings: Partial<PlaybackSettings>) => void;
  targetDeviceName?: string;
}
```

### 7. `AmbientScreenProps` ([`src/components/AmbientScreen.tsx:6-12`](file:///C:/PROYECTOS/cinecast/cinecast/src/components/AmbientScreen.tsx#L6-L12))
```ts
interface AmbientScreenProps {
  deviceName: string;
  roomId: string;
  recentMedia: MediaItem[];
  onWakeScreen: () => void;
  onPlayDirectly: (media: MediaItem) => void;
}
```

### 8. `ContinueWatchingRowProps` ([`src/components/ContinueWatchingRow.tsx:7-13`](file:///C:/PROYECTOS/cinecast/cinecast/src/components/ContinueWatchingRow.tsx#L7-L13))
```ts
interface ContinueWatchingRowProps {
  items: WatchProgressItem[];
  onPlay: (media: MediaItem, episode?: Episode | null, initialTime?: number) => void;
  onCast?: (media: MediaItem, episode?: Episode | null) => void;
  onRemove: (id: string) => void;
  connectedScreenName?: string;
}
```

### 9. `GuestShareModalProps` ([`src/components/GuestShareModal.tsx:6-11`](file:///C:/PROYECTOS/cinecast/cinecast/src/components/GuestShareModal.tsx#L6-L11))
```ts
interface GuestShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  screenName: string;
}
```

### 10. `DualScreenSimulatorProps` ([`src/components/DualScreenSimulator.tsx:8-22`](file:///C:/PROYECTOS/cinecast/cinecast/src/components/DualScreenSimulator.tsx#L8-L22))
```ts
interface DualScreenSimulatorProps {
  isOpen: boolean;
  onClose: () => void;
  playbackState: PlaybackState;
  currentMedia: MediaItem | null;
  currentEpisode: Episode | null;
  catalog: MediaItem[];
  onSendCommand: (cmd: RemoteCommand) => void;
  onUpdateAudio: (audio: Partial<AudioSettings>) => void;
  onUpdatePlayback: (playback: Partial<PlaybackSettings>) => void;
  onOpenAudioModal: () => void;
  onOpenCastModal: () => void;
  onPlayMedia: (media: MediaItem, episode?: Episode) => void;
  onNextEpisode: () => void;
}
```

---

## d. Métodos de `deviceSync` (`src/services/deviceSync.ts`) usados en `App.tsx`

1. `deviceSync.getDeviceType()` (`src/App.tsx:48`)
2. `deviceSync.getRoomId()` (`src/App.tsx:49`)
3. `deviceSync.onWatchHistory(cb)` (`src/App.tsx:194`)
4. `deviceSync.getCachedPlaybackState()` (`src/App.tsx:217`)
5. `deviceSync.requestWakeLock()` (`src/App.tsx:255`)
6. `deviceSync.releaseWakeLock()` (`src/App.tsx:258`)
7. `deviceSync.connect(targetRoom)` (`src/App.tsx:269`)
8. `deviceSync.onRemoteConnected(cb)` (`src/App.tsx:273`)
9. `deviceSync.onDevicesUpdate(cb)` (`src/App.tsx:278`)
10. `deviceSync.onCommand(cb)` (`src/App.tsx:308`)
11. `deviceSync.onStateSync(cb)` (`src/App.tsx:312`)
12. `deviceSync.getDeviceName()` (`src/App.tsx:465, 549, 989, 1026, 1136`)
13. `deviceSync.broadcastPlaybackState(state)` (`src/App.tsx:472, 558, 996, 1034, 1170`)
14. `deviceSync.sendCommand(command, targetDeviceId?)` (`src/App.tsx:925, 951, 1550, 1574`)
15. `deviceSync.setDeviceType(type)` (`src/App.tsx:1149, 1206, 1715`)
16. `deviceSync.getDeviceId()` (`src/App.tsx:1701`)
17. `deviceSync.setRoomId(newRoomId)` (`src/App.tsx:1710`)

---

## e. Grafo de dependencias en texto (Componente -> Estados de `App.tsx`)

- **`AmbientScreen`** <- `isScreenInStandby`, `deviceRole`, `roomId`
- **`VideoPlayer`** <- `isPlayingLocally`, `activeMedia`, `activeEpisode`, `activeHub`, `audioSettings`, `playbackSettings`, `lastRemoteCommand`, `playerInitialTime`, `remotePlaybackState`, `remoteNotification`
- **`Navbar`** <- `currentCategory`, `searchQuery`, `devices`, `selectedScreenId` (vía `connectedScreenName`), `deviceRole`, `activeHub`, `homeRoomId` + `roomId` (vía `isPermanentHomeLinked`)
- **`SpotifyHub`** <- `activeHub`, `activeSpotifyTrack`, `isSpotifyPlaying`, `audioSettings` (`volume`, `isMuted`), `deviceRole`, `connectedScreenName`
- **`YouTubeHub`** <- `activeHub`, `activeYouTubeVideo`, `isYouTubePlaying`, `audioSettings` (`volume`, `isMuted`), `deviceRole`, `lastRemoteCommand`, `connectedScreenName`
- **`HeroBanner`** <- `featuredMedia`, `connectedScreenName`
- **`ContinueWatchingRow`** <- `continueWatchingList`, `connectedScreenName`
- **`MovieGrid`** <- `currentCategory`, `myListIds`, `connectedScreenName`, `deviceRole`
- **`MovieRow`** <- `myListIds`, `connectedScreenName`
- **`RemoteControlDrawer`** <- `deviceRole`, `remotePlaybackState`, `remoteMediaItem` (`remotePlaybackState` + `activeMedia`), `remoteEpisodeItem` (`remotePlaybackState` + `activeEpisode`), `connectedScreenName`
- **`DetailModal`** <- `selectedMediaForDetails`, `myListIds`, `connectedScreenName`
- **`AudioSettingsModal`** <- `isAudioModalOpen`, `audioSettings`, `playbackSettings`
- **`CastModal`** <- `isCastModalOpen`, `devices`, `roomId`, `deviceRole`, `selectedScreenId`, `isPermanentHomeLinked`
- **`GuestShareModal`** <- `isGuestModalOpen`, `roomId`, `connectedScreenName`
- **`DualScreenSimulator`** <- `isDualSimulatorOpen`, `remotePlaybackState`, `remoteMediaItem`, `remoteEpisodeItem`

---

## f. Lecturas y escrituras en `localStorage` (claves y `archivo:línea`)

| Clave en `localStorage` | Lecturas (`getItem`) | Escrituras (`setItem`) | Borrados (`removeItem`) |
| :--- | :--- | :--- | :--- |
| `cinecast_home_room_id` | `src/App.tsx:55` | `src/App.tsx:378` | `src/App.tsx:374` |
| `cinecast_my_list` | `src/App.tsx:145` | `src/App.tsx:338` | — |
| `cinecast_ui_v2` | `src/main.tsx:37` | `src/main.tsx:30` | `src/main.tsx:34, 51`, `src/ui/NewApp.tsx:431` |
| `cinecast_last_server_host` | `src/services/deviceSync.ts:43` | — | — |
| `cinecast_device_id` | `src/services/deviceSync.ts:116` | `src/services/deviceSync.ts:119` | — |
| `cinecast_room_id` | `src/services/deviceSync.ts:130` | `src/services/deviceSync.ts:128, 235, 651` | — |
| `cinecast_device_type` | — | `src/services/deviceSync.ts:151, 244, 643` | — |
| `cinecast_device_name` | — | `src/services/deviceSync.ts:152, 240, 635` | — |
| `cinecast_last_playback_state_<roomId>` | `src/services/deviceSync.ts:226` | `src/services/deviceSync.ts:481, 537` | — |
| `cinecast_cross_event_<roomId>` | *(vía evento `storage` en `src/services/deviceSync.ts:169`)* | `src/services/deviceSync.ts:524, 562` | — |
| `cinecast_watch_progress_v2` | `src/services/watchHistoryService.ts:31` | `src/services/watchHistoryService.ts:111, 151, 190` | `src/services/watchHistoryService.ts:202` |
| `cinecast_topbar_hidden` | `src/components/VideoPlayer.tsx:173` | `src/components/VideoPlayer.tsx:182` | — |
| `cinecast_preferred_server` | `src/components/VideoPlayer.tsx:305, 484`, `src/services/embedService.ts:224` | `src/components/VideoPlayer.tsx:718`, `src/services/embedService.ts:227` | — |
| `cinecast_marathon_mode` | `src/components/DetailModal.tsx:80`, `src/components/VideoPlayer.tsx:516` | `src/components/DetailModal.tsx:90`, `src/components/VideoPlayer.tsx:526` | — |
| `cinecast_only_spanish` | `src/components/MovieGrid.tsx:101` | `src/components/MovieGrid.tsx:125` | — |
| `cinecast_yt_tv_mode` | `src/components/YouTubeHub.tsx:43` | `src/components/YouTubeHub.tsx:141` | — |
| `cinecast_catalog_v7` | `src/data/mediaCatalog.ts:1743` | `src/components/CustomStreamModal.tsx:157`, `src/services/mediaSync.ts:12` | — |
| `cinecast_spotify_token` | `src/services/authService.ts:68, 114` | `src/services/authService.ts:108, 247` | `src/services/authService.ts:124` |
| `cinecast_spotify_user` | `src/services/authService.ts:69` | `src/services/authService.ts:109, 260` | `src/services/authService.ts:125` |
| `cinecast_spotify_client_id` | `src/services/authService.ts:47` | `src/services/authService.ts:51` | — |
| `cinecast_google_token` | `src/services/authService.ts:70, 192` | `src/services/authService.ts:265` | `src/services/authService.ts:186` |
| `cinecast_google_user` | `src/services/authService.ts:71` | `src/services/authService.ts:278` | `src/services/authService.ts:187` |
| `cinecast_google_client_id` | `src/services/authService.ts:58` | `src/services/authService.ts:62` | — |
| `cinecast_audio_prefs_v1` | `src/services/audioPrefs.ts:12` | `src/services/audioPrefs.ts:43` | — |
| `cinecast_diagnostic_mode` | `src/services/diagnosticService.ts:42` | `src/services/diagnosticService.ts:76` | — |
| `cinecast_no_cors_fix` | `src/services/diagnosticService.ts:46` | `src/services/diagnosticService.ts:102` | — |
| `cinecast_provider_health_v1` | `src/services/embedService.ts:27` | `src/services/embedService.ts:48` | — |
| `cinecast_iptv_cache_v3` | `src/services/iptvService.ts:810` | `src/services/iptvService.ts:822` | — |
| `cinecast_tmdb_cache_v3` | `src/services/tmdbService.ts:44` | `src/services/tmdbService.ts:54` | `src/services/tmdbService.ts:330` |
| `cinecast_tmdb_api_key` | `src/services/tmdbService.ts:163` | `src/services/tmdbService.ts:169` | — |
| `cinecast_animelatino_slug_cache_v1` | `src/services/animeLatinoService.ts:12` | `src/services/animeLatinoService.ts:22` | — |
| `cinemate_bookmarks` | `src/utils/storage.js:17` (`src/context/BookmarksContext.jsx:24`) | `src/utils/storage.js:37` (`src/context/BookmarksContext.jsx:29`) | `src/utils/storage.js:51` |

---

## g. Comportamientos que hoy dependen de que `App.tsx` esté montado

1. **Conexión a la sala y registro del dispositivo (`deviceSync.connect`)**: `deviceSync` instancia el `deviceId` y el `BroadcastChannel` al importarse, pero **no** abre el WebSocket `/ws`, ni envía `POST /api/sync/join`, ni arranca el polling HTTP de respaldo hasta que se ejecuta el `useEffect` de `src/App.tsx:263-301` (`deviceSync.connect(targetRoom)`).
2. **Recepción y ejecución de comandos remotos (`deviceSync.onCommand`)**: El listener que procesa `playMedia`, `playDiscoveredMovie`, `randomEpisode`, `switchHub`, `playYouTube`, `controlSpotify`, `togglePlay`, `play`, `pause`, `seek`, `seekRelative`, `setVolume`, `toggleMute`, `trackpadMove/Click/Scroll` y teclas D-Pad (`navigateUp/Down/Left/Right`, `select`, `back`) vive en `src/App.tsx:307-332` y `385-836`. Si `App.tsx` no está montado, los comandos del celular llegan a `deviceSync` pero ningún suscriptor los ejecuta.
3. **Sincronización de estado hacia controles remotos (`broadcastPlaybackState` y polling de `getRealMediaState`)**: Tanto el broadcast reactivo (`src/App.tsx:1039-1044`) como el intervalo cada 2 segundos que consulta `window.electronAPI.getRealMediaState()` (`src/App.tsx:1047-1064`) dependen de que `App.tsx` esté montado.
4. **Sincronización inicial y en tiempo real de `Continuar Viendo`**: El llamado inicial a `watchHistoryService.syncWithServer()` y la suscripción a `deviceSync.onWatchHistory` se registran en `src/App.tsx:188-202`.
5. **Indicador visual del cursor virtual (Modo Trackpad)**: La suscripción a `window.electronAPI.onVirtualCursorPosition` y el renderizado del puntero flotante cian (`z-[99999]`) están en `src/App.tsx:240-250` y `1749-1763`.
6. **Procesamiento de callback OAuth en el hash de la URL**: `authService.handleRedirectCallback()` solo se invoca al montar `App.tsx` (`src/App.tsx:33-39`).
7. **Chequeo periódico de salud de proveedores embed**: `refreshProviderHealth()` al arranque y cada 3 horas se ejecuta en `src/App.tsx:42-46`.
8. **WakeLock de pantalla en el celular**: `deviceSync.requestWakeLock()` cuando `deviceRole === 'remote'` se activa en `src/App.tsx:253-260`.
