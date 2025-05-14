'use client';

import React, { useEffect, useState, useImperativeHandle, forwardRef, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

interface SpotifyPlaybackSDKProps {
  accessToken: string | null;
  // Callback para notificar al padre (page.tsx) sobre cambios de estado
  onStateChange?: (state: any) => void;
  // Callback para notificar cuando una canción termina o está por terminar, pasando el ID de la pista terminada
  onTrackEnd?: (trackId: string | null) => void;
  // Callback para notificar cuando el reproductor está listo y dar su device_id
  onReady?: (deviceId: string) => void;
}

// Declarar globalmente la interfaz de Spotify Web Playback SDK
declare global {
  interface Window {
    Spotify: any;
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

export interface SpotifyPlaybackSDKRef {
  playUri: (uri: string) => Promise<void>;
  pause: () => Promise<void>;
  // Otros métodos de control si son necesarios
}

const SpotifyPlaybackSDK = forwardRef<SpotifyPlaybackSDKRef, SpotifyPlaybackSDKProps>(
  ({ accessToken, onStateChange, onTrackEnd, onReady }, ref) => {
    const { toast } = useToast();
    const [player, setPlayer] = useState<any>(null);
    const [isReady, setIsReady] = useState(false);
    const [currentPlaybackState, setCurrentPlaybackState] = useState<any>(null);
    // Usar ref para controlar si ya notificamos el fin de la canción para evitar duplicados
    const notificationLock = useRef(false);

    // Exponer métodos a través del ref
    useImperativeHandle(ref, () => ({
      playUri: async (uri: string) => {
        if (player && isReady) {
          console.log("Intentando reproducir URI:", uri);
          try {
            await player.play({ uris: [uri] });
            console.log("Comando play enviado al SDK.");
          } catch (err: any) {
            console.error("Error al enviar comando play al SDK:", err);
            toast({
              title: 'Error de Reproducción SDK',
              description: `No se pudo enviar el comando de reproducción: ${err.message || err}.`,
              variant: 'destructive'
            });
            throw err;
          }
        } else {
          console.warn("Reproductor SDK no listo para reproducir URI.");
          const errorMsg = "Reproductor SDK no listo para reproducir.";
          toast({
            title: 'Error de Reproducción',
            description: errorMsg,
            variant: 'destructive'
          });
          throw new Error(errorMsg);
        }
      },
      pause: async () => {
        if (player && isReady) {
          console.log("Intentando pausar SDK.");
          try {
            await player.pause();
            console.log("Comando pause enviado al SDK.");
          } catch (err: any) {
            console.error("Error al enviar comando pause al SDK:", err);
            toast({
              title: 'Error al Pausar SDK',
              description: `No se pudo enviar el comando de pausa: ${err.message || err}.`,
              variant: 'destructive'
            });
            throw err;
          }
        } else {
          console.warn("Reproductor SDK no listo para pausar.");
          const errorMsg = "Reproductor SDK no listo para pausar.";
          toast({
            title: 'Error al Pausar',
            description: errorMsg,
            variant: 'destructive'
          });
          throw new Error(errorMsg);
        }
      },
    }));

    useEffect(() => {
      const cleanup = () => {
        if (player) {
          console.log('Desconectando reproductor Spotify en cleanup...');
          player.disconnect();
        }

        if (window.onSpotifyWebPlaybackSDKReady) {
          window.onSpotifyWebPlaybackSDKReady = () => { console.log('SDK ready (placeholder)'); };
        }
      };

      if (!accessToken) {
        console.log("No access token, desconectando reproductor si existe.");
        cleanup();
        setPlayer(null);
        setIsReady(false);
        setCurrentPlaybackState(null);
        onStateChange?.(null);
        return cleanup;
      }

      if (!window.Spotify) {
        console.warn("Spotify Web Playback SDK no está cargado aún. Esperando window.onSpotifyWebPlaybackSDKReady.");
        return cleanup;
      }

      if (window.Spotify && accessToken && !player) {
        console.log("SDK ya cargado y token disponible. Inicializando reproductor.");

        const initializePlayer = () => {
          const spotifyPlayer = new window.Spotify.Player({
            name: 'Bar Jukebox',
            getOAuthToken: (cb: (token: string) => void) => { cb(accessToken); },
            volume: 0.5,
          });

          spotifyPlayer.addListener('ready', ({ device_id }: { device_id: string }) => {
            console.log('Dispositivo listo!', device_id);
            setIsReady(true);
            onReady?.(device_id);
            toast({
              title: 'Reproductor Listo',
              description: 'El Jukebox está conectado a Spotify.',
            });
          });

          spotifyPlayer.addListener('not_ready', ({ device_id }: { device_id: string }) => {
            console.log('Dispositivo se desconectó', device_id);
            setIsReady(false);
            toast({
              title: 'Reproductor Desconectado',
              description: 'El Jukebox se ha desconectado de Spotify.',
              variant: 'destructive'
            });
            setCurrentPlaybackState(null);
            onStateChange?.(null);
          });

          spotifyPlayer.addListener('player_state_changed', (state: any) => {
            console.log('Estado del reproductor cambió:', state);
            setCurrentPlaybackState(state);
            onStateChange?.(state);

            if (state && !state.paused && state.track_window.current_track) {
              const track = state.track_window.current_track;
              const position = state.position;
              const duration = track.duration_ms;
              const threshold = 2000; 
              const remaining = duration - position;

              if (remaining < threshold && !notificationLock.current) {
                console.log(`Canción por terminar (quedan ${remaining}ms). Notificando...`);
                notificationLock.current = true;

                // Pasa el ID de la canción que está terminando (la actual)
                // O, para ser más precisos sobre la que *terminó*, la primera en previous_tracks
                const endedTrackId = state.track_window?.previous_tracks?.[0]?.id || state.track_window?.current_track?.id || null;
                onTrackEnd?.(endedTrackId);

                setTimeout(() => { notificationLock.current = false; }, 5000); 
              }
            } else if (state && state.paused && state.position === 0 && currentPlaybackState && !currentPlaybackState.paused) {
              console.log('Canción parece haber terminado (estado pausado en 0). Notificando...');
              if (!notificationLock.current) {
                notificationLock.current = true;
                // Pasa el ID de la canción que estaba sonando antes de pausar en 0
                const endedTrackId = currentPlaybackState.track_window?.current_track?.id || state.track_window?.previous_tracks?.[0]?.id || null;
                onTrackEnd?.(endedTrackId);
                setTimeout(() => { notificationLock.current = false; }, 5000);
              }
            }

            if (currentPlaybackState && state && state.track_window.current_track.id !== currentPlaybackState.track_window.current_track.id) {
              console.log("Cambio de canción detectado, restableciendo notificationLock.");
              notificationLock.current = false;
            }
          });

          spotifyPlayer.addListener('initialization_error', ({ message }: { message: string }) => {
            console.error('Error de inicialización del SDK:', message);
            toast({
              title: 'Error del Reproductor Spotify',
              description: `Fallo al iniciar el reproductor: ${message}`,
              variant: 'destructive'
            });
            setIsReady(false);
            setCurrentPlaybackState(null);
            onStateChange?.(null);
          });

          spotifyPlayer.addListener('authentication_error', ({ message }: { message: string }) => {
            console.error('Error de autenticación del SDK:', message);
            toast({
              title: 'Error de Autenticación Spotify',
              description: `Token inválido: ${message}. Intentando refrescar...`,
              variant: 'destructive'
            });
            setIsReady(false);
            setCurrentPlaybackState(null);
            onStateChange?.(null);
          });

          spotifyPlayer.addListener('account_error', ({ message }: { message: string }) => {
            console.error('Error de cuenta del SDK:', message);
            toast({
              title: 'Error de Cuenta Spotify',
              description: `Problema con la cuenta: ${message}.`,
              variant: 'destructive'
            });
            setIsReady(false);
            setCurrentPlaybackState(null);
            onStateChange?.(null);
          });

          spotifyPlayer.addListener('playback_error', ({ message }: { message: string }) => {
            console.error('Error de reproducción del SDK:', message);
            toast({
              title: 'Error de Reproducción Spotify',
              description: `Problema al reproducir: ${message}.`,
              variant: 'destructive'
            });
          });

          spotifyPlayer.connect();
          setPlayer(spotifyPlayer);
        };

        if (window.Spotify) {
          initializePlayer();
        } else {
          window.onSpotifyWebPlaybackSDKReady = initializePlayer;
        }
      }

      return cleanup;

    }, [accessToken, toast, onStateChange, onTrackEnd, onReady, player]);

    return null;
  }
);

SpotifyPlaybackSDK.displayName = 'SpotifyPlaybackSDK'; 

export default SpotifyPlaybackSDK;