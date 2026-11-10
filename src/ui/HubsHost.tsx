import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { SpotifyHub } from '../components/SpotifyHub';
import { YouTubeHub } from '../components/YouTubeHub';
import { SPOTIFY_TRACKS } from '../data/spotifyCatalog';
import { YOUTUBE_VIDEOS } from '../data/youtubeCatalog';
import { useAppRuntime } from '../app/AppRuntime';

const OFFSCREEN_CLASS =
  'fixed -left-[20000px] top-0 w-[1280px] h-[800px] overflow-hidden pointer-events-none select-none';

export const HubsHost: React.FC = () => {
  const location = useLocation();
  const {
    deviceRole,
    connectedScreenName,
    activeHub,
    activeSpotifyTrack,
    setActiveSpotifyTrack,
    isSpotifyPlaying,
    setIsSpotifyPlaying,
    activeYouTubeVideo,
    setActiveYouTubeVideo,
    isYouTubePlaying,
    setIsYouTubePlaying,
    audioSettings,
    lastRemoteCommand,
    sendRemoteCommand,
    triggerNotification,
  } = useAppRuntime();

  const isMusicaRoute = location.pathname.startsWith('/musica');
  const isYouTubeRoute = location.pathname.startsWith('/youtube');

  const [hasMountedSpotify, setHasMountedSpotify] = useState<boolean>(
    isMusicaRoute || activeHub === 'spotify'
  );
  const [hasMountedYouTube, setHasMountedYouTube] = useState<boolean>(
    isYouTubeRoute || activeHub === 'youtube'
  );

  useEffect(() => {
    if ((isMusicaRoute || activeHub === 'spotify') && !hasMountedSpotify) {
      setHasMountedSpotify(true);
    }
  }, [isMusicaRoute, activeHub, hasMountedSpotify]);

  useEffect(() => {
    if ((isYouTubeRoute || activeHub === 'youtube') && !hasMountedYouTube) {
      setHasMountedYouTube(true);
    }
  }, [isYouTubeRoute, activeHub, hasMountedYouTube]);

  if (!hasMountedSpotify && !hasMountedYouTube) {
    return null;
  }

  return (
    <>
      {hasMountedSpotify && (
        <div
          aria-hidden={!isMusicaRoute}
          className={isMusicaRoute ? 'w-full' : OFFSCREEN_CLASS}
        >
          <SpotifyHub
            isActive={isMusicaRoute}
            currentTrack={activeSpotifyTrack}
            isPlaying={isSpotifyPlaying}
            volume={audioSettings.volume}
            isMuted={audioSettings.isMuted}
            isScreenMode={deviceRole !== 'remote'}
            onSelectTrack={(track) => {
              setActiveSpotifyTrack(track);
              setIsSpotifyPlaying(true);
              if (deviceRole === 'remote') {
                sendRemoteCommand({
                  action: 'playSpotifyTrack',
                  payload: { track },
                });
                triggerNotification(`🎵 Enviado a ${connectedScreenName}: ${track.title}`);
              }
            }}
            onTogglePlay={() => {
              setIsSpotifyPlaying((p) => !p);
              if (deviceRole === 'remote') {
                sendRemoteCommand({ action: isSpotifyPlaying ? 'pause' : 'play' });
              }
            }}
            onNextTrack={() => {
              const idx = SPOTIFY_TRACKS.findIndex((t) => t.id === activeSpotifyTrack?.id);
              const next = SPOTIFY_TRACKS[(idx + 1) % SPOTIFY_TRACKS.length]!;
              setActiveSpotifyTrack(next);
              setIsSpotifyPlaying(true);
              if (deviceRole === 'remote') {
                sendRemoteCommand({ action: 'playSpotifyTrack', payload: { track: next } });
              }
            }}
            onPrevTrack={() => {
              const idx = SPOTIFY_TRACKS.findIndex((t) => t.id === activeSpotifyTrack?.id);
              const prev =
                SPOTIFY_TRACKS[(idx - 1 + SPOTIFY_TRACKS.length) % SPOTIFY_TRACKS.length]!;
              setActiveSpotifyTrack(prev);
              setIsSpotifyPlaying(true);
              if (deviceRole === 'remote') {
                sendRemoteCommand({ action: 'playSpotifyTrack', payload: { track: prev } });
              }
            }}
            onCastTrackToScreen={(track) => {
              setActiveSpotifyTrack(track);
              setIsSpotifyPlaying(true);
              sendRemoteCommand({
                action: 'playSpotifyTrack',
                payload: { track },
              });
              triggerNotification(`🎵 Reproduciendo "${track.title}" en ${connectedScreenName}`);
            }}
            connectedScreenName={connectedScreenName}
          />
        </div>
      )}

      {hasMountedYouTube && (
        <div
          aria-hidden={!isYouTubeRoute}
          className={isYouTubeRoute ? 'w-full' : OFFSCREEN_CLASS}
        >
          <YouTubeHub
            isActive={isYouTubeRoute}
            currentVideo={activeYouTubeVideo}
            isPlaying={isYouTubePlaying}
            volume={audioSettings.volume}
            isMuted={audioSettings.isMuted}
            isScreenMode={deviceRole !== 'remote'}
            remoteCommandTrigger={lastRemoteCommand}
            onSelectVideo={(video) => {
              setActiveYouTubeVideo(video);
              setIsYouTubePlaying(true);
              if (deviceRole === 'remote') {
                sendRemoteCommand({
                  action: 'playYouTubeVideo',
                  payload: { video },
                });
                triggerNotification(`▶️ Enviado a ${connectedScreenName}: ${video.title}`);
              }
            }}
            onTogglePlay={() => {
              setIsYouTubePlaying((p) => !p);
              if (deviceRole === 'remote') {
                sendRemoteCommand({ action: isYouTubePlaying ? 'pause' : 'play' });
              }
            }}
            onNextVideo={() => {
              const idx = YOUTUBE_VIDEOS.findIndex((v) => v.id === activeYouTubeVideo?.id);
              const next = YOUTUBE_VIDEOS[(idx + 1) % YOUTUBE_VIDEOS.length]!;
              setActiveYouTubeVideo(next);
              setIsYouTubePlaying(true);
              if (deviceRole === 'remote') {
                sendRemoteCommand({ action: 'playYouTubeVideo', payload: { video: next } });
              }
            }}
            onPrevVideo={() => {
              const idx = YOUTUBE_VIDEOS.findIndex((v) => v.id === activeYouTubeVideo?.id);
              const prev =
                YOUTUBE_VIDEOS[(idx - 1 + YOUTUBE_VIDEOS.length) % YOUTUBE_VIDEOS.length]!;
              setActiveYouTubeVideo(prev);
              setIsYouTubePlaying(true);
              if (deviceRole === 'remote') {
                sendRemoteCommand({ action: 'playYouTubeVideo', payload: { video: prev } });
              }
            }}
            onSeekRelative={(seconds) => {
              sendRemoteCommand({
                action: 'seekRelative',
                payload: { seconds },
              });
            }}
            onCastVideoToScreen={(video) => {
              setActiveYouTubeVideo(video);
              setIsYouTubePlaying(true);
              sendRemoteCommand({
                action: 'playYouTubeVideo',
                payload: { video },
              });
              triggerNotification(`📺 Reproduciendo "${video.title}" en ${connectedScreenName}`);
            }}
            connectedScreenName={connectedScreenName}
          />
        </div>
      )}
    </>
  );
};
