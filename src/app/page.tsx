'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import type { Song, SpotifyConfig } from '@/services/spotify';
import {
  Music,
  Search,
  ListMusic,
  PlusCircle,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ListVideo,
  Settings, // Added Settings icon
} from 'lucide-react';
import { searchSpotify } from '@/services/spotify';
import {
  // IPC Methods from the new wrapper
  getSongQueue,
  addSongToQueue,
  removeSongFromQueue, // This might need careful handling for "remove own song"
  onSongQueueUpdated,
  getApplicationSettings,
  onApplicationSettingsUpdated,
  isElectron,
  Song as ElectronSong,
  ApplicationSettings as ElectronSettings,
  confirmTrackStarted, // Import new IPC function
  handleTrackEnded,    // Import new IPC function
  getCurrentPlaying,   // Added for current playing track
  getApplicationSettings as getPlayerAppSettings, // Alias to avoid conflict if used elsewhere
  playTrackOnSpotify as playTrackOnSpotifyIPC, // Alias for clarity
} from '@/lib/electron-ipc';
import { ToastAction } from '@/components/ui/toast';
import Image from 'next/image';
import Link from 'next/link'; // Added Link import
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

// Definir interfaces con tipado estricto
// Use ElectronSong for queue items, potentially extend if 'id' or 'order' is needed for UI keys/sorting
type QueueSong = ElectronSong & { id?: string; order?: number; addedByUserId?: string };


interface PlaylistDetails {
  name: string;
  description: string;
  imageUrl: string | null;
}

// Extender el tipo Error para incluir propiedades adicionales
interface FetchError extends Error {
  info?: any;
  status?: number;
}

// SWR fetcher corregido para manejar promesas y tipado


export default function ClientPage() {
  const { toast } = useToast();
  const syncLock = useRef(false); // This might be re-evaluated or used differently
  const lastPlayedTrackIdRef = useRef<string | null>(null); // To track changes

  // Estado general
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [queue, setQueue] = useState<QueueSong[]>([]); // Uses updated QueueSong type
  const [isLoadingSearch, setIsLoadingSearch] = useState(false);
  const [isLoadingQueue, setIsLoadingQueue] = useState(true);
  const [userSessionId, setUserSessionId] = useState<string | null>(null); // Keep for now, might be used for local identification if needed
  const [appError, setAppError] = useState<string | null>(null); // Generic error state
  const [spotifyConfig, setSpotifyConfig] = useState<ElectronSettings | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [playlistDetails, setPlaylistDetails] = useState<PlaylistDetails | null>(null);
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Estado para currently playing
  const [currentPlaying, setCurrentPlaying] = useState<{
    isPlaying: boolean;
    track?: {
      id: string;
      name: string;
      artists: string[];
      albumArtUrl: string | null;
      progress_ms: number;
      duration_ms: number;
    };
  } | null>(null);
  const [currentError, setCurrentError] = useState<string | null>(null);

  // Fetch currently playing via IPC instead of SWR
  useEffect(() => {
    if (!isElectron() || !isMounted) return;

    const fetchCurrentPlaying = async () => {
      try {
        const result = await getCurrentPlaying();
        if (result.success && result.data) {
          const data = result.data;
          setCurrentPlaying({
            isPlaying: data.isPlaying,
            track: data.title ? {
              id: data.spotifyTrackId || '',
              name: data.title,
              artists: [data.artist || ''],
              albumArtUrl: data.albumArtUrl || null,
              progress_ms: data.progress_ms || 0,
              duration_ms: data.duration_ms || 0,
            } : undefined
          });
          setCurrentError(null);
        } else {
          setCurrentPlaying({ isPlaying: false });
          if (result.errorType !== 'SPOTIFY_API_UNAVAILABLE') {
            setCurrentError(result.error || 'Error al cargar pista actual');
          }
        }
      } catch (error: any) {
        setCurrentError(error.message || 'Error al cargar pista actual');
        setCurrentPlaying({ isPlaying: false });
      }
    };

    fetchCurrentPlaying();
    const interval = setInterval(fetchCurrentPlaying, 3000);
    return () => clearInterval(interval);
  }, [isMounted]);

  // 1. Marcar componente montado
  useEffect(() => {
    setIsMounted(true);
  }, []);


  // Effect for track start and end detection using IPC
  useEffect(() => {
    if (!isElectron() || !currentPlaying || !isMounted) return;

    const currentTrack = currentPlaying.track;

    if (currentPlaying.isPlaying && currentTrack) {
      // Track has started or changed
      if (currentTrack.id !== lastPlayedTrackIdRef.current) {
        console.log(`New track started: ${currentTrack.name} (${currentTrack.id})`);
        lastPlayedTrackIdRef.current = currentTrack.id;
        confirmTrackStarted(currentTrack.id)
          .then(result => {
            if (result.success) {
              toast({ title: "Playback Confirmed", description: `${currentTrack.name} marked as playing.` });
              // Queue should update via onSongQueueUpdated if needed
            } else {
              toast({ title: "Error Confirming Playback", description: result.error, variant: "destructive" });
            }
          })
          .catch(err => {
            toast({ title: "IPC Error", description: `Failed to confirm playback: ${err.message}`, variant: "destructive" });
          });
      }

      // Track end detection (check if progress is very close to duration)
      const bufferMs = 1500; // Buffer for track end detection
      if (currentTrack.duration_ms > 0 && currentTrack.progress_ms >= currentTrack.duration_ms - bufferMs) {
        if (!syncLock.current) { // syncLock to prevent multiple calls for the same track end
          syncLock.current = true;
          console.log(`Track ended: ${currentTrack.name} (${currentTrack.id}). Handling next track.`);
          
          handleTrackEnded()
            .then(async result => {
              if (result.success) {
                if (result.hasNextSong && result.nextSong) {
                  toast({ title: "Track Ended", description: `Playing next: ${result.nextSong.title}` });
                  // TODO: Implement actual playback of result.nextSong.spotifyTrackId
                  // This would involve an API call to Spotify to play the track.
                  // For now, we'll log it.
                  console.log(`TODO: Initiate playback for ${result.nextSong.spotifyTrackId}`);
                  const appSettingsResult = await getPlayerAppSettings();
                  if (appSettingsResult.success && appSettingsResult.settings?.spotifyDeviceId) {
                    const deviceId = appSettingsResult.settings.spotifyDeviceId;
                    // Ensure nextSong has a URI. The search result should provide 'uri', if not, construct it.
                    const trackUri = result.nextSong.uri || `spotify:track:${result.nextSong.spotifyTrackId}`;
                    
                    toast({ title: "Playing Next Track", description: `Attempting to play ${result.nextSong.title} on selected device.` });
                    
                    const playResult = await playTrackOnSpotifyIPC(trackUri, deviceId);
                    if (playResult.success) {
                      // Playback initiated. The SWR hook for /api/spotify/current should eventually reflect the new song.
                      // confirmTrackStarted will then be called by the effect that watches currentPlaying.
                      console.log(`Playback of ${result.nextSong.title} initiated on ${deviceId}.`);
                    } else {
                      toast({ title: "Playback Error", description: playResult.error || "Could not play next track.", variant: "destructive" });
                      console.error("Error playing track via IPC:", playResult.error, playResult.details);
                       if (playResult.error?.includes("device not found") || playResult.details?.toString().includes("NO_ACTIVE_DEVICE")) {
                         toast({ title: "Device Issue", description: "Spotify device not found or inactive. Please check Spotify and Admin settings.", variant: "destructive", duration: 7000 });
                       }
                    }
                  } else if (appSettingsResult.success && !appSettingsResult.settings?.spotifyDeviceId) {
                     toast({ title: "No Device Selected", description: "Please select a Spotify playback device in Admin settings.", variant: "warning", duration: 7000 });
                     console.warn("No Spotify device ID set in application settings.");
                  } else {
                     toast({ title: "Settings Error", description: "Could not retrieve app settings to find playback device.", variant: "destructive" });
                  }
                } else {
                  toast({ title: "Queue Ended", description: "No more songs in the queue." });
                  console.log("Queue is empty. Playback paused/stopped.");
                  // TODO: Optionally send a pause command to Spotify if desired (e.g. PUT /v1/me/player/pause)
                }
              } else {
                toast({ title: "Error Handling Track End", description: result.error || "Could not determine next song.", variant: "destructive" });
              }
            })
            .catch(err => {
              toast({ title: "IPC Error", description: `Failed to handle track end: ${err.message}`, variant: "destructive" });
            })
            .finally(() => {
              // Release lock after a delay to allow next track to start and currentPlaying to update
              setTimeout(() => {
                syncLock.current = false;
              }, 5000); // Adjust delay as needed
            });
        }
      }
    } else if (!currentPlaying.isPlaying && lastPlayedTrackIdRef.current) {
      // Playback stopped, but a track was playing. Reset lock if necessary.
      // This helps if a song is manually paused then ended.
      // If syncLock was true, and playback stops, it means the track didn't "complete" naturally
      // via the progress check, but was paused/stopped.
      if (syncLock.current) {
        console.log("Playback stopped, resetting syncLock for potential early pause/stop.");
        syncLock.current = false; 
      }
      // Consider if lastPlayedTrackIdRef.current should be cleared here or when new track starts.
      // Clearing here means if user resumes the same song, it will trigger confirmTrackStarted again.
      // lastPlayedTrackIdRef.current = null; 
    } else if (!currentPlaying.isPlaying) {
      // Playback is stopped
      const canAttemptResume = queue.length > 0 && spotifyConfig?.spotifyDeviceId && !syncLock.current;

      if (canAttemptResume) {
        console.log("Playback is stopped, queue has songs. Attempting to play next from queue.");
        syncLock.current = true; 

        const nextSongToPlay = queue[0]; // Assumes queue is sorted by addedAt
        const trackUri = nextSongToPlay.uri || `spotify:track:${nextSongToPlay.spotifyTrackId}`;
        const deviceId = spotifyConfig.spotifyDeviceId!; // We've checked spotifyConfig.spotifyDeviceId

        toast({ title: "Resuming Queue", description: `Attempting to play ${nextSongToPlay.title}.` });

        playTrackOnSpotifyIPC(trackUri, deviceId)
          .then(playResult => {
            if (playResult.success) {
              console.log(`Playback of ${nextSongToPlay.title} initiated from stopped state.`);
              // lastPlayedTrackIdRef will be updated by the "new track started" logic when currentPlaying updates
            } else {
              toast({ title: "Playback Error", description: playResult.error || "Could not resume queue.", variant: "destructive" });
              console.error("Error resuming queue via IPC:", playResult.error, playResult.details);
               if (playResult.error?.includes("device not found") || playResult.details?.toString().includes("NO_ACTIVE_DEVICE")) {
                 toast({ title: "Device Issue", description: "Spotify device not found or inactive for queue resumption. Please check Spotify and Admin settings.", variant: "destructive", duration: 7000 });
               }
            }
          })
          .catch(err => {
            toast({ title: "IPC Error", description: `Failed to resume queue: ${err.message}`, variant: "destructive" });
          })
          .finally(() => {
            setTimeout(() => {
              syncLock.current = false;
            }, 5000); // Release lock after an attempt
          });
      } else if (lastPlayedTrackIdRef.current) {
        // This condition means: playback is stopped, AND
        // (queue is empty OR deviceId is not set OR syncLock is already held by another process like track ending)
        // AND a track *was* previously playing (lastPlayedTrackIdRef.current is not null).
        // This is the state where we should truly consider playback as "finished for now".
        if (syncLock.current && !canAttemptResume) { 
            console.log("Playback stopped, not resuming (syncLock was true, e.g. from a recently ended track). Resetting syncLock.");
            syncLock.current = false; // Reset lock if it was held by the track ending logic
        }
        console.log("Playback stopped, not resuming from queue (e.g. queue empty or device issue). Clearing last played track ID.");
        lastPlayedTrackIdRef.current = null;
      }
    }
  }, [currentPlaying, isMounted, toast, queue, spotifyConfig]);


  // 2. Generar o recuperar sesión sencilla - Kept for now, can be used for local identification if desired
  useEffect(() => {
    let sid = sessionStorage.getItem('jukeboxUserSessionId');
    if (!sid) {
      sid = `user_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('jukeboxUserSessionId', sid);
    }
    setUserSessionId(sid);
  }, []);

  // 3. Load application settings via IPC
  useEffect(() => {
    if (!isElectron()) {
      setAppError("Esta aplicación está diseñada para Electron. Algunas funciones pueden no estar disponibles.");
      setIsLoadingConfig(false);
      setIsLoadingQueue(false);
      return;
    }
    setIsLoadingConfig(true);
    getApplicationSettings().then(result => {
      if (result.success && result.settings) {
        setSpotifyConfig(result.settings);
      } else {
        toast({ title: 'Error', description: result.error || 'No se pudo cargar la configuración.', variant: 'destructive' });
        setAppError(result.error || 'Error al cargar configuración.');
      }
      setIsLoadingConfig(false);
    });

    const unsubSettings = onApplicationSettingsUpdated((updatedSettings) => {
      setSpotifyConfig(updatedSettings);
      toast({ title: 'Configuración actualizada', description: 'Los ajustes de la aplicación han cambiado.' });
    });
    
    return () => unsubSettings();
  }, [toast]);

  // 4. Note: Playlist details are no longer loaded via API
  // This functionality is temporarily disabled as the application
  // now handles everything through IPC and local Spotify calls
  useEffect(() => {
    if (!isMounted || !spotifyConfig || spotifyConfig.searchMode !== 'playlist' || !spotifyConfig.playlistId) {
      setPlaylistDetails(null);
      setIsLoadingPlaylist(false);
      return;
    }
    
    // TODO: Implement playlist details loading via IPC if needed
    // For now, set a placeholder
    setPlaylistDetails({
      name: 'Playlist Configurada',
      description: 'Detalles cargados localmente',
      imageUrl: null
    });
    setIsLoadingPlaylist(false);
  }, [spotifyConfig, isMounted, toast]);


  // 5. Load and subscribe to song queue via IPC
  useEffect(() => {
    if (!isElectron()) return;
    setIsLoadingQueue(true);
    getSongQueue().then(result => {
      if (result.success && result.queue) {
        // Assuming ElectronSong array, map to QueueSong if needed (e.g. for 'id' or specific 'order')
        // For now, direct assignment if ElectronSong matches QueueSong structure well enough.
        // Add 'id' for React key if not present, using spotifyTrackId
        setQueue(result.queue.map(s => ({ ...s, id: s.spotifyTrackId, order: s.addedAt })));
      } else {
        toast({ title: 'Error', description: result.error || 'No se pudo cargar la cola.', variant: 'destructive' });
        setAppError(result.error || 'Error al cargar la cola.');
      }
      setIsLoadingQueue(false);
    });

    const unsubQueue = onSongQueueUpdated((updatedQueue) => {
      setQueue(updatedQueue.map(s => ({ ...s, id: s.spotifyTrackId, order: s.addedAt })));
      // Consider if a toast is needed for every queue update, might be too noisy
    });

    return () => unsubQueue();
  }, [toast]);

  // 6. Búsqueda con debounce optimizado
  const doSearch = useCallback(async () => {
    if (!searchTerm.trim() || isLoadingConfig || !spotifyConfig) {
      setSearchResults([]);
      return;
    }

    if (spotifyConfig.searchMode === 'playlist' && !spotifyConfig.playlistId) {
      toast({
        title: 'Playlist no configurada',
        description: 'El administrador necesita configurar una ID de playlist.',
        variant: 'destructive',
      });
      setSearchResults([]);
      return;
    }

    setIsLoadingSearch(true);
    try {
      const res = await searchSpotify(searchTerm, spotifyConfig);
console.log('Raw search response:', res);

// Protección robusta contra null/undefined/estructura inesperada
const safeResults = Array.isArray(res)
  ? res.filter((t): t is Song => !!t && typeof t === 'object' && typeof t.spotifyTrackId === 'string' && typeof t.title === 'string' && typeof t.artist === 'string')
  : [];


setSearchResults(safeResults);


    } catch (e: any) {
      console.error('Error en la búsqueda de Spotify:', e);
      toast({
        title: 'Error de Búsqueda',
        description: e.message || 'Fallo en la búsqueda de Spotify.',
        variant: 'destructive',
      });
      setSearchResults([]);
    } finally {
      setIsLoadingSearch(false);
    }
  }, [searchTerm, spotifyConfig, isLoadingConfig, toast]);

  // Este sigue siendo el de búsqueda — se deja tal cual
  useEffect(() => {
    if (!isMounted || isLoadingConfig) return;
    const id = setTimeout(doSearch, 500);
    return () => clearTimeout(id);
  }, [searchTerm, doSearch, isMounted, isLoadingConfig]);

  // Note: The automatic sync functionality is now handled by the track end detection
  // in the currentPlaying useEffect above. This effect is kept for reference but disabled.
  useEffect(() => {
    // This effect is disabled as sync is now handled via IPC
    // The previous sync API call has been removed
    return;
  }, [currentPlaying]);

  // 7. Añadir canción a la cola via IPC
  const handleAddSong = async (song: Song) => {
    if (!isElectron()) {
      toast({ title: 'Error', description: 'Función no disponible fuera de Electron.', variant: 'destructive' });
      return;
    }
    
    // Simplified: "canAddSong" logic might be enforced by main process or removed.
    // For now, allow adding if not already in queue.
    const alreadyInQueue = queue.some((q) => q.spotifyTrackId === song.spotifyTrackId);
    if (alreadyInQueue) {
      toast({ title: 'Canción Repetida', description: `${song.title} ya está en la cola.`, variant: 'info' });
      return;
    }

    // The 'addedByUserId' can be passed if needed, or main process can omit/handle it.
    // For now, we'll pass the userSessionId if available.
    const songToAdd: Omit<ElectronSong, 'addedAt'> & { addedByUserId?: string | null } = {
      spotifyTrackId: song.spotifyTrackId,
      title: song.title,
      artist: song.artist,
      albumArtUrl: song.albumArtUrl || undefined,
      addedByUserId: userSessionId, // Optional: main process might not use this
    };

    const result = await addSongToQueue(songToAdd);
    if (result.success) {
      setSearchTerm('');
      setSearchResults([]);
      toast({ title: 'Canción Añadida', description: `${song.title} ha sido añadida a la cola.` });
      // Queue updates via onSongQueueUpdated listener
    } else {
      toast({ title: 'Error al Añadir', description: result.error || 'No se pudo añadir la canción.', variant: 'destructive' });
    }
  };

  // 7.1 Load All Songs
  const handleLoadAllSongs = async () => {
    if (!spotifyConfig || spotifyConfig.searchMode !== 'playlist' || !spotifyConfig.playlistId) {
      toast({
        title: 'Error de Configuración',
        description: 'La búsqueda debe estar en modo playlist y con una playlist configurada.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoadingSearch(true);
    try {
      // Use the local searchSpotify service which now uses IPC
      // We'll do a search for '*' to get all songs from the playlist
      const allTracks = await searchSpotify('*', spotifyConfig, 0, 500); // Get up to 500 songs
      
      setSearchResults(allTracks);
      toast({
        title: 'Playlist Cargada',
        description: `Se cargaron ${allTracks.length} canciones de la playlist.`,
      });
    } catch (error: any) {
      console.error('Error al cargar todas las canciones:', error);
      toast({
        title: 'Error al Cargar Playlist',
        description: error.message || 'No se pudieron cargar todas las canciones de la playlist.',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingSearch(false);
    }
  };

  // 8. Quitar propia canción via IPC (if this specific user-based removal logic is kept)
  const handleRemoveOwnSong = async (spotifyTrackId: string) => {
    if (!isElectron()) return;
    // This presumes the main process can identify "own" songs or that we pass userSessionId
    // For simplicity, this might just become a generic remove, or the admin page handles all removals.
    // If we want to keep "remove own song", the main process would need the `addedByUserId` and the current `userSessionId`.
    // Let's assume for now it's a general remove, and admin handles specific removals.
    // The original `handleRemoveSong` took `id` (Firebase key). Now we use `spotifyTrackId`.
    
    const songToRemove = queue.find(s => s.spotifyTrackId === spotifyTrackId && s.addedByUserId === userSessionId);
    if (!songToRemove) {
      toast({ title: 'Error', description: 'No se encontró tu canción para eliminar.', variant: 'destructive' });
      return;
    }

    const result = await removeSongFromQueue(spotifyTrackId);
    if (result.success) {
      toast({ title: 'Canción Eliminada', description: 'Tu canción ha sido eliminada de la cola.' });
      // Queue updates via onSongQueueUpdated listener
    } else {
      toast({ title: 'Error al Eliminar', description: result.error || 'No se pudo quitar la canción.', variant: 'destructive' });
    }
  };

  // 9. Memoizar componentes para optimizar renderizado
  const SearchResultItem = useMemo(() => {
    return ({ song }: { song: Song }) => {
      const inQueue = queue.some((q) => q.spotifyTrackId === song.spotifyTrackId);
      const addedByThisUser = queue.some(
        (q) => q.spotifyTrackId === song.spotifyTrackId && q.addedByUserId === userSessionId
      );
      const hasUserProposedAnySong = queue.some((q) => q.addedByUserId === userSessionId);
      
  // Simplified logic: can add if not in queue. "One song per user" rule is managed by `hasUserProposedAnySong`.
      const canCurrentUserAdd = !inQueue && !hasUserProposedAnySong;

      return (
        <div
          key={song.spotifyTrackId}
          className={`flex items-center justify-between p-2 rounded-md transition-colors ${
        canCurrentUserAdd && isElectron() ? 'hover:bg-secondary/50 cursor-pointer' : 'opacity-70 cursor-not-allowed' 
          }`}
      onClick={() => canCurrentUserAdd && isElectron() && handleAddSong(song)}
        >
          <div className="flex items-center gap-3 overflow-hidden">
            {song.albumArtUrl ? (
              <Image
                src={song.albumArtUrl}
                alt={song.title}
                width={40}
                height={40}
                className="rounded shadow-sm"
              />
            ) : (
              <div className="h-10 w-10 bg-muted rounded flex items-center justify-center shadow-sm">
                <Music className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="truncate flex-1">
              <p className="font-medium truncate text-sm">{song.title}</p>
              <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
            </div>
          </div>
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation(); // Always stop propagation
                if (addedByThisUser && isElectron()) {
                      handleRemoveOwnSong(song.spotifyTrackId);
                } else if (canCurrentUserAdd && isElectron()) {
                      handleAddSong(song);
                    }
                  }}
                  disabled={!isElectron() || (inQueue && !addedByThisUser) || (hasUserProposedAnySong && !addedByThisUser && !inQueue) }
                  aria-label={
                    addedByThisUser ? 'Quitar de la cola'
                      : inQueue ? 'Ya en cola'
                      : hasUserProposedAnySong ? 'Ya añadiste una canción'
                      : 'Añadir a la cola'
                  }
                  className={`h-8 w-8 rounded-full ${
                    addedByThisUser ? 'text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50'
                      : inQueue ? 'text-green-500'
                      : ''
                  }`}
                >
                  {addedByThisUser ? <XCircle /> : inQueue ? <CheckCircle /> : <PlusCircle />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {addedByThisUser ? 'Quitar de la cola'
                    : inQueue ? 'Ya está en la cola'
                    : hasUserProposedAnySong ? 'Ya añadiste una canción'
                    : 'Añadir a la cola'}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      );
    };
}, [queue, userSessionId, handleAddSong, handleRemoveOwnSong, isElectron]); // Added isElectron to dependency array

  // 10. Pantalla de error general
  if (appError && !isLoadingQueue && !isLoadingConfig && isMounted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Card className="max-w-lg w-full border border-destructive bg-destructive/10 shadow-xl rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle /> Error de Aplicación
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-destructive-foreground">{appError}</p>
            <p className="text-sm text-destructive-foreground/80 mt-2">
              Algunas funcionalidades pueden no estar disponibles. Si el problema persiste, contacta al administrador o revisa la consola.
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="destructive" onClick={() => window.location.reload()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Recargar Página
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // 11. Render principal
  return (
    <div className="container mx-auto p-4 min-h-screen bg-gradient-to-br from-background via-background to-secondary/10">
      {/* ─── Cabecera ───────────────────────────────────────────────────────── */}
      <header className="text-center my-8 space-y-2">
        <h1 className="text-4xl md:text-5xl font-bold text-primary flex items-center justify-center gap-3 relative">
          <Music className="h-8 w-8 md:h-10 md:w-10" /> 
          Bar Jukebox
          <div className="absolute right-0 top-1/2 -translate-y-1/2">
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/admin" passHref>
                    <Button variant="ghost" size="icon" aria-label="Ir a Configuración">
                      <Settings className="h-6 w-6" />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Configuración</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </h1>
        <p className="text-lg text-muted-foreground">¡Elige la banda sonora de la noche!</p>
        {spotifyConfig?.searchMode === 'playlist' && playlistDetails && (
          <p className="text-sm text-muted-foreground">Playlist actual: {playlistDetails.name}</p>
        )}
      </header>

      {/* ─── Actualmente sonando ─────────────────────────────────────────── */}
      <Card className="mb-6 shadow-md border border-border/50 overflow-hidden rounded-lg">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-primary">Ahora Suena</CardTitle>
        </CardHeader>
        <CardContent>
          {currentError ? (
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Error al cargar la pista actual.
            </p>
          ) : !currentPlaying ? (
            <div className="flex items-center gap-4">
              <Skeleton className="h-16 w-16 rounded" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-2 w-full mt-2" />
              </div>
            </div>
          ) : currentPlaying.isPlaying && currentPlaying.track ? (
            <div className="flex items-center gap-4">
              {currentPlaying.track.albumArtUrl ? (
                <Image
                  src={currentPlaying.track.albumArtUrl}
                  alt={currentPlaying.track.name}
                  width={64}
                  height={64}
                  className="rounded-md shadow"
                />
              ) : (
                <div className="h-16 w-16 rounded-md bg-muted flex items-center justify-center shadow">
                  <Music className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 overflow-hidden">
                <p className="font-medium truncate">{currentPlaying.track.name}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {currentPlaying.track.artists.join(', ')}
                </p>
                <progress
                  value={currentPlaying.track.progress_ms}
                  max={currentPlaying.track.duration_ms}
                  className="w-full mt-2 h-1.5 rounded-full overflow-hidden bg-muted [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
                  aria-label="Progreso de la canción"
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Spotify está en pausa o inactivo.</p>
          )}
        </CardContent>
      </Card>

      {/* ─── Contenido Principal (Búsqueda y Cola) ───────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-6 mb-12">
        {/* ─── Columna de Búsqueda ─────────────────────────────────────────── */}
        <div className="lg:col-span-1">
          <Card className="h-full flex flex-col shadow-md border border-border/50 rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl text-primary">
                <Search /> Buscar Canciones
              </CardTitle>
              <CardDescription>
                {isLoadingConfig ? (
                  <Skeleton className="h-4 w-32" />
                ) : spotifyConfig?.searchMode === 'playlist' ? (
                  isLoadingPlaylist ? (
                    <Skeleton className="h-4 w-40" />
                  ) : playlistDetails ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center gap-1 text-sm">
                            <ListVideo className="h-4 w-4 mr-1" />
                            Playlist: <span className="font-medium truncate max-w-[150px]">{playlistDetails.name}</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{playlistDetails.name}</p>
                          {playlistDetails.description && (
                            <p className="text-xs text-muted-foreground">{playlistDetails.description}</p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <span className="text-destructive text-sm flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" /> Playlist no cargada
                    </span>
                  )
                ) : (
                  'Explorando todo Spotify'
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col flex-1 pt-0">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Nombre de canción o artista..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  disabled={
                    !isElectron() ||
                    isLoadingConfig ||
                    (spotifyConfig?.searchMode === 'playlist' && !playlistDetails && !isLoadingPlaylist)
                  }
                  className="pl-10 pr-4 py-2 border-border focus:border-primary focus:ring-primary rounded-md"
                />
              </div>
              <div className="flex justify-between items-center mt-2">
                <p className="text-xs text-muted-foreground italic flex-1">
                  {isElectron() && queue.some(s => s.addedByUserId === userSessionId) 
                    ? "Ya has añadido una canción. Para añadir otra, primero quita la actual."
                    : isElectron() 
                    ? "Puedes añadir una canción a la cola."
                    : "La adición de canciones está deshabilitada."}
                </p>
                {spotifyConfig?.searchMode === 'playlist' && spotifyConfig.playlistId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadAllSongs}
                    disabled={!isElectron() || isLoadingConfig || isLoadingSearch || !spotifyConfig.playlistId}
                    className="ml-2"
                  >
                    {isLoadingSearch && !searchTerm ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <ListMusic className="mr-2 h-4 w-4" />}
                     Ver Todas
                  </Button>
                )}
              </div>
              <ScrollArea className="flex-1 -mx-4 px-4">
                <div className="space-y-2 pr-2 pb-4">
                  {isLoadingSearch ? (
                    [...Array(5)].map((_, i) => (
                      <div key={i} className="flex items-center gap-3 p-2">
                        <Skeleton className="h-10 w-10 rounded" />
                        <div className="space-y-1 flex-1">
                          <Skeleton className="h-4 w-3/4 rounded" />
                          <Skeleton className="h-3 w-1/2 rounded" />
                        </div>
                        <Skeleton className="h-8 w-8 rounded-full" />
                      </div>
                    ))
                  ) : searchResults.length > 0 ? (
                    searchResults.map((song) => <SearchResultItem key={song.spotifyTrackId} song={song} />)
                  ) : searchTerm && !isLoadingSearch ? (
                    <p className="text-center text-sm text-muted-foreground py-4">No se encontraron resultados.</p>
                  ) : (
                    <p className="text-center text-sm text-muted-foreground py-4">Empieza a buscar...</p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* ─── Columna de Cola ────────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <Card className="h-full flex flex-col shadow-md border border-border/50 rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl text-primary">
                <ListMusic /> Cola de Reproducción
              </CardTitle>
              <CardDescription>Las canciones que sonarán a continuación.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-3">
                  {isLoadingQueue ? (
                    [...Array(5)].map((_, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 bg-muted/50 rounded-md animate-pulse">
                        <Skeleton className="h-12 w-12 rounded" />
                        <div className="space-y-1 flex-1">
                          <Skeleton className="h-4 w-3/4 rounded" />
                          <Skeleton className="h-3 w-1/2 rounded" />
                        </div>
                        <Skeleton className="h-6 w-6 rounded-full" />
                      </div>
                    ))
                  ) : queue.length > 0 ? (
                    queue.map((song, idx) => (
                      <div
                        key={song.spotifyTrackId} // Use spotifyTrackId as key
                        className={`flex items-center gap-3 p-3 rounded-md transition-colors ${
                          song.addedByUserId === userSessionId ? 'bg-secondary/60' : 'hover:bg-secondary/30'
                        }`}
                      >
                        <span className="w-6 text-center font-medium text-muted-foreground">{idx + 1}</span>
                        {song.albumArtUrl ? (
                          <Image
                            src={song.albumArtUrl}
                            alt={song.title}
                            width={48}
                            height={48}
                            className="rounded shadow-sm"
                          />
                        ) : (
                          <div className="h-12 w-12 bg-muted rounded flex items-center justify-center shadow-sm">
                            <Music className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 truncate">
                          <p className="truncate font-medium">{song.title}</p>
                          <p className="text-sm text-muted-foreground truncate">{song.artist}</p>
                        </div>
                        {song.addedByUserId === userSessionId && isElectron() && (
                          <div className="flex items-center gap-2">
                            <TooltipProvider delayDuration={100}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full"
                                    onClick={() => handleRemoveOwnSong(song.spotifyTrackId)}
                                    aria-label="Quitar mi canción"
                                  >
                                    <XCircle />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Quitar mi canción</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-center py-10 text-muted-foreground">
                      La cola está vacía. ¡Añade algunas canciones!
                    </p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      <footer className="text-center mt-12 mb-6 text-sm text-muted-foreground">
        Hecho con ❤️ y 🎵 para tu disfrute.
      </footer>

      <footer className="w-full text-center text-gray-500 text-sm p-4">
        Version: {process.env.NEXT_PUBLIC_APP_VERSION}
      </footer>
    </div>
  );
}