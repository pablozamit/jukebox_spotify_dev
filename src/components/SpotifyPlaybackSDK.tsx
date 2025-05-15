import 'react'; // Keep this import

import React, {
  useEffect,
  useState,
  useImperativeHandle,
  forwardRef,
  useRef,
  ForwardedRef
} from 'react';

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
  ({ accessToken, onStateChange, onTrackEnd, onReady }, ref: ForwardedRef<SpotifyPlaybackSDKRef>) => {
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
            const state = await player.getCurrentState();
            if (!state || !state.device_id) throw new Error("No se pudo obtener el device_id actual.");

            await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${state.device_id}`, {
              method: 'PUT',
              body: JSON.stringify({ uris: [uri] }),
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
              },
            });
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
      let scriptAdded = false;

      if (!accessToken) {
        console.log("No access token, desconectando reproductor si existe.");
        if (player) {
          player.disconnect();
        }
        setPlayer(null);
        setIsReady(false);
        setCurrentPlaybackState(null);
        onStateChange?.(null);
        return;
      }

      // Define la función que se ejecutará cuando el SDK esté listo
      const initializePlayer = () => {
        if (!accessToken) {
          console.warn("Access token no disponible durante onSpotifyWebPlaybackSDKReady. No se puede inicializar el reproductor.");
          return;
        }
        if (player) {
           console.log("Reproductor ya inicializado.");
           return;
        }

        console.log("onSpotifyWebPlaybackSDKReady disparado. Inicializando reproductor.");

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

          // Nueva detección reforzada de final de canción
          if (
            state &&
            state.paused &&
            state.position === 0 &&
            !state.track_window?.next_tracks?.length &&
            !notificationLock.current
          ) {
            console.log('Detección reforzada: la canción terminó y no hay siguiente pista.');
            notificationLock.current = true;
            const endedTrackId = state.track_window?.current_track?.id || null;
            onTrackEnd?.(endedTrackId);
            setTimeout(() => { notificationLock.current = false; }, 5000);
          }

          if (state.track_window?.next_tracks?.length > 0) {
            console.warn("⚠️ Spotify ha planificado una canción siguiente que no está bajo nuestro control:", state.track_window.next_tracks[0]);
          }

          if (currentPlaybackState && state && state.track_window.current_track.id !== currentPlaybackState.track_window.current_track.id) {
            console.log("Cambio de canción detectado, restableciendo notificationLock.");
            notificationLock.current = false;
          }
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

        // Conectar el reproductor
        spotifyPlayer.connect().then((success: boolean) => {
           if (success) {
               console.log("Reproductor Spotify conectado.");
           } else {
               console.log("Reproductor Spotify no pudo conectarse.");
           }
        });
        setPlayer(spotifyPlayer); // Establecer el reproductor después de intentar conectar
      };
      window.onSpotifyWebPlaybackSDKReady = initializePlayer;

      // Añade el script del SDK si no está ya presente
      if (!document.getElementById('spotify-playback-sdk')) {
        const script = document.createElement('script');
        script.id = 'spotify-playback-sdk';
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        document.body.appendChild(script);
        scriptAdded = true;
        console.log("Script del Spotify Web Playback SDK añadido dinámicamente.");
      } else {
        console.log("Script del Spotify Web Playback SDK ya presente.");
        if (window.Spotify && !player) {
          console.log("SDK ya presente y listo. Inicializando reproductor inmediatamente.");
          initializePlayer();
        }
      }

      // Función de limpieza
      return () => {
        console.log('Ejecutando cleanup para SpotifyPlaybackSDK...');
        if (player) {
          console.log('Desconectando reproductor Spotify...');
          player.disconnect();
        }

        if (window.onSpotifyWebPlaybackSDKReady === initializePlayer) {
          window.onSpotifyWebPlaybackSDKReady = () => {
            console.log('SDK ready (placeholder) - previous component unmounted');
          };
        }

        if (scriptAdded) {
          const scriptElement = document.getElementById('spotify-playback-sdk');
          if (scriptElement) {
            scriptElement.remove();
            console.log("Script del Spotify Web Playback SDK removido.");
          }
        }
      };
    }, [accessToken, toast, onStateChange, onTrackEnd, onReady, player]);

    return null;
  }
);

SpotifyPlaybackSDK.displayName = 'SpotifyPlaybackSDK';

export { SpotifyPlaybackSDK };