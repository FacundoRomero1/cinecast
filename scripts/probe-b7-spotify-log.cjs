#!/usr/bin/env node
/**
 * scripts/probe-b7-spotify-log.cjs
 * Verificación de instrumentación B7 (Spotify):
 *  - Verifica que SpotifyDevice y AppRuntime logueen:
 *    1. Cada player_state_changed (position, duration, paused, track_window.current_track.id)
 *    2. Cada initialization_error, authentication_error, account_error
 *    3. El origen de cada next disparado (SpotifyDevice.handleNext, AppRuntime.handlePlayNextEpisode)
 */
const { chromium } = require('playwright');
const { startTestEnv } = require('./lib/testenv.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let testEnv = null;
  let browser = null;
  try {
    testEnv = await startTestEnv({
      name: 'probe-b7-spotify-log',
      env: { NODE_ENV: 'production' },
    });
    const { base: baseUrl, room: activeRoomId } = testEnv;

    try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
    catch { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();

    const spotifyLogs = [];
    page.on('console', (msg) => {
      const txt = msg.text();
      if (txt.includes('[SPOTIFY]')) {
        spotifyLogs.push(txt);
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem('cinecast_spotify_client_id', '1234567890abcdef1234567890abcdef');
      window.__spotifyListeners = {};
      window.__spotifyStats = {
        constructorCalls: 0,
        disconnectCalls: 0,
        nextTrackCalls: 0,
        setVolumeCalls: [],
        nextTrackIds: [],
      };
      window.Spotify = {
        Player: class MockSpotifyPlayer {
          constructor(opts) {
            this.opts = opts;
            this.trackIdx = 0;
            this.tracks = [
              { id: '4uLU6hMCjMI75M1A2tKUQC', name: 'Test Track 1' },
              { id: '7GhIk7Il098yCjg4BQjzvb', name: 'Test Track 2' },
              { id: '3n3Ppam7vgaVa1iaRUc9Lp', name: 'Test Track 3' },
              { id: '0VjIjW4GlUZAMYd2vXMi3b', name: 'Test Track 4' },
            ];
            window.__spotifyStats.constructorCalls += 1;
          }
          addListener(evt, fn) {
            window.__spotifyListeners[evt] = fn;
          }
          async setVolume(v) {
            window.__spotifyStats.setVolumeCalls.push(Number(v.toFixed(2)));
          }
          async connect() {
            setTimeout(() => {
              // Ráfaga previa a ready: 5 next antes de conectar solo deben disparar 1 pending nextTrack
              for (let i = 0; i < 5; i++) {
                window.dispatchEvent(new CustomEvent('cinecast:spotify-next', { detail: { origin: 'pre-ready-burst' } }));
              }
              window.__spotifyListeners.player_state_changed?.({
                position: 12450,
                duration: 215000,
                paused: false,
                track_window: {
                  current_track: this.tracks[this.trackIdx],
                },
              });
              window.__spotifyListeners.ready?.({ device_id: 'mock-cinecast-device-1' });
            }, 250);
            return true;
          }
          async nextTrack() {
            window.__spotifyStats.nextTrackCalls += 1;
            this.trackIdx = (this.trackIdx + 1) % this.tracks.length;
            const tr = this.tracks[this.trackIdx];
            window.__spotifyStats.nextTrackIds.push(tr.id);
            window.__spotifyListeners.player_state_changed?.({
              position: 0,
              duration: 198000,
              paused: false,
              track_window: { current_track: tr },
            });
          }
          async previousTrack() {
            this.trackIdx = (this.trackIdx - 1 + this.tracks.length) % this.tracks.length;
            const tr = this.tracks[this.trackIdx];
            window.__spotifyListeners.player_state_changed?.({
              position: 0,
              duration: 198000,
              paused: false,
              track_window: { current_track: tr },
            });
          }
          disconnect() {
            window.__spotifyStats.disconnectCalls += 1;
          }
        },
      };
    });

    // Mockear /api/auth/status y /api/auth/spotify/status como conectado para que SpotifyDevice entre en 'connecting' y monte el SDK
    await page.route('**/api/auth/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          spotify: {
            connected: true,
            profile: { id: 'test-user', displayName: 'CineCast User', product: 'premium' },
          },
        }),
      })
    );
    await page.route('**/api/auth/spotify/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          connected: true,
          profile: { id: 'test-user', displayName: 'CineCast User', product: 'premium' },
        }),
      })
    );

    await page.goto(`${baseUrl}/?role=screen&ui=nuevo&room=${encodeURIComponent(activeRoomId)}#/musica`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await wait(2200);

    const callsAfterPreReadyBurst = await page.evaluate(() => window.__spotifyStats.nextTrackCalls);

    // Cambiar volumen 3 veces vía UI -> debe invocar setVolume SIN recrear ni desconectar Player
    const slider = page.locator('input[type="range"]').last();
    for (const v of ['35', '65', '20']) {
      await slider.evaluate((el, val) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, v);
      await wait(120);
    }

    const callsBeforeUiNext = await page.evaluate(() => window.__spotifyStats.nextTrackCalls);
    // 1. Disparar next desde el botón del reproductor SpotifyDevice (SpotifyDevice.handleNext)
    const nextBtn = page.locator('button[aria-label="Pista siguiente"], button[aria-label="Siguiente"]').first();
    if (await nextBtn.count()) {
      await nextBtn.click();
    }
    await wait(300);
    const callsAfterUiNext = await page.evaluate(() => window.__spotifyStats.nextTrackCalls);

    // 2. Disparar next desde comando remoto (AppRuntime.handlePlayNextEpisode)
    await fetch(`${baseUrl}/api/sync/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: activeRoomId,
        command: { action: 'nextEpisode' },
      }),
    });
    await wait(600);
    const statsFinal = await page.evaluate(() => window.__spotifyStats);

    // 3. Emitir errores del SDK para verificar que los 3 listeners los registran
    await page.evaluate(() => {
      window.__spotifyListeners.initialization_error?.({ message: 'EME_NOT_SUPPORTED_TEST' });
      window.__spotifyListeners.authentication_error?.({ message: 'TOKEN_EXPIRED_TEST' });
      window.__spotifyListeners.account_error?.({ message: 'PREMIUM_REQUIRED_TEST' });
    });
    await wait(200);

    const checks = {
      singleConstructorOnVolumeChanges: statsFinal.constructorCalls === 1,
      zeroDisconnectsOnVolumeChanges: statsFinal.disconnectCalls === 0,
      setVolumeCalled: statsFinal.setVolumeCalls.length >= 2,
      preReadyBurstCoalescedToOne: callsAfterPreReadyBurst === 1,
      uiNextCalledOnce: callsAfterUiNext - callsBeforeUiNext === 1,
      remoteNextCalledOnce: statsFinal.nextTrackCalls - callsAfterUiNext === 1,
      noStaticTrackIds: !statsFinal.nextTrackIds.some((id) => String(id).startsWith('sp-')),
      hasPlayerStateChangedLog: spotifyLogs.some((l) =>
        l.includes('[SPOTIFY] player_state_changed position=12450 duration=215000 paused=false track_window.current_track.id=4uLU6hMCjMI75M1A2tKUQC')
      ),
      hasInitErrorLog: spotifyLogs.some((l) =>
        l.includes('[SPOTIFY] initialization_error message=EME_NOT_SUPPORTED_TEST')
      ),
      hasAuthErrorLog: spotifyLogs.some((l) =>
        l.includes('[SPOTIFY] authentication_error message=TOKEN_EXPIRED_TEST')
      ),
      hasAccountErrorLog: spotifyLogs.some((l) =>
        l.includes('[SPOTIFY] account_error message=PREMIUM_REQUIRED_TEST')
      ),
      hasUiNextOriginLog: spotifyLogs.some((l) =>
        l.includes('[SPOTIFY] next triggered origin=SpotifyDevice.handleNext')
      ),
      hasRemoteNextOriginLog: spotifyLogs.some((l) =>
        l.includes('[SPOTIFY] next triggered origin=AppRuntime.handlePlayNextEpisode')
      ),
    };
    const pass = Object.values(checks).every(Boolean);

    console.log('\n=== RESULTADO INSTRUMENTACIÓN B7 (SPOTIFY) ===');
    console.log(
      JSON.stringify(
        {
          checks,
          statsFinal,
          spotifyLogs,
          resultado: pass ? 'PASA' : 'FALLA',
        },
        null,
        2
      )
    );

    await browser.close();
    await testEnv.stop();
    process.exit(pass ? 0 : 1);
  } catch (err) {
    console.error('[probe-b7-spotify-log] Error:', err);
    if (browser) await browser.close().catch(() => {});
    if (testEnv) await testEnv.stop().catch(() => {});
    process.exit(1);
  }
})();
