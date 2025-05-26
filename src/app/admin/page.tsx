'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
// Firebase Auth and DB imports removed
// import { onAuthStateChanged, signOut, User } from 'firebase/auth';
// import { ref, onValue, remove, update, push, set, serverTimestamp, get } from 'firebase/database';
// import { auth, db, isDbValid } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import useSWR from 'swr';
import {
  // IPC Methods from the new wrapper
  loginToSpotify,
  getValidSpotifyAccessToken,
  onSpotifyAuthSuccess,
  onSpotifyReauthRequired,
  getSongQueue,
  addSongToQueue,
  removeSongFromQueue,
  clearSongQueue,
  onSongQueueUpdated,
  getApplicationSettings,
  updateApplicationSettings,
  onApplicationSettingsUpdated,
  isElectron,
  Song as ElectronSong, // Renamed to avoid conflict with local Song type
  ApplicationSettings as ElectronSettings, // Renamed
  spotifyLogout, // Import new logout function
  onSpotifyDisconnected, // Import new listener
  getSpotifyDevices, // Import new function
  SpotifyDevice // Import type
} from '@/lib/electron-ipc';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  ListMusic, Music, Trash2, ArrowUp, ArrowDown, Settings,
  Search, Home, LogOut, AlertTriangle, RefreshCw, PlusCircle, ExternalLink, ListVideo
} from 'lucide-react';
import Image from 'next/image';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Use ElectronSong for queue items
// interface QueueSong {
//   id: string; // This might need to be adapted if Electron side doesn't use a separate 'id'
//   spotifyTrackId: string;
//   title: string;
//   artist: string;
//   albumArtUrl?: string;
//   order?: number; // Order might be implicit by array order from electron-store
//   addedByUserId?: string; // User concept is removed for now
//   timestampAdded: number; // Will be 'addedAt' from ElectronSong
//   votes?: number;
// }
type QueueSong = ElectronSong & { id?: string }; // Keep 'id' if used for React keys, map from spotifyTrackId


// Local Song type for search results, etc.
interface Song {
  spotifyTrackId: string;
  title:string;
  artist: string;
  albumArtUrl?: string;
}

// Use ElectronSettings for config
// interface SpotifyConfig {
//   searchMode: 'playlist' | 'all';
//   playlistId?: string;
//   spotifyConnected?: boolean; // This will be derived from token status
// }
type SpotifyConfig = ElectronSettings;


interface PlaylistDetails {
  name: string;
  description: string;
  imageUrl: string | null;
  externalUrl?: string;
}

interface SpotifyStatus {
  spotifyConnected: boolean;
  tokensOk: boolean;
  playbackAvailable: boolean;
  activeDevice?: { id: string; name: string; type: string };
  message?: string;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Error al cargar datos.');
  return res.json();
};

export default function AdminPage() {
  const router = useRouter();
  const { toast } = useToast();
  const isSyncingRef = useRef(false); // Keep for now, related to /api/spotify/sync

  // User state and loadingAuth removed
  // const [user, setUser] = useState<User | null>(null);
  // const [loadingAuth, setLoadingAuth] = useState(true);

  const [queue, setQueue] = useState<QueueSong[]>([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState(true);
  const [config, setConfig] = useState<SpotifyConfig>({ searchMode: 'all', playlistId: null, spotifyDeviceId: null });
  const [playlistIdInput, setPlaylistIdInput] = useState('');
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  
  // spotifyStatus will be simplified, based on token availability
  const [spotifyConnected, setSpotifyConnected] = useState(false); 
  // const [spotifyAccessToken, setSpotifyAccessToken] = useState<string | null>(null); // Not needed directly, getSpotifyAccessToken handles it
  const [playlistDetails, setPlaylistDetails] = useState<PlaylistDetails | null>(null);
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [isLoadingSearch, setIsLoadingSearch] = useState(false);
  const [availableDevices, setAvailableDevices] = useState<SpotifyDevice[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);

  const { data: currentPlaying, mutate: mutateCurrentPlaying } = useSWR('/api/spotify/current', fetcher, { refreshInterval: 5000 });

  // Sync Interval - Keep for now, will be refactored or removed in Step 4
  // useEffect(() => {
  //   const interval = setInterval(async () => {
  //     if (isSyncingRef.current) return;
  //     isSyncingRef.current = true;
  //     try {
  //       console.log('[Jukebox Admin] Intentando llamar a /api/spotify/sync...');
  //       const syncRes = await fetch('/api/spotify/sync', { method: 'POST' });
  //       const syncJson = await syncRes.json();
  //       if (syncRes.status === 429) {
  //         console.log('[Jukebox Admin] Ya hay una sincronización activa.');
  //         return;
  //       }
  //       if (!syncRes.ok) {
  //         console.error('[Jukebox Admin] Error:', syncJson.error || syncJson.message);
  //         toast({ title: 'Error de sincronización', description: syncJson.error || syncJson.message, variant: 'destructive' });
  //       } else {
  //         if (syncJson.success && syncJson.enqueued) mutateCurrentPlaying();
  //       }
  //     } catch (error) {
  //       console.error('[Jukebox Admin] Error en fetch:', error);
  //       toast({ title: 'Error de red', description: 'No se pudo conectar.', variant: 'destructive' });
  //     } finally {
  //       setTimeout(() => { isSyncingRef.current = false; }, 3000);
  //     }
  //   }, 5000);
  //   return () => clearInterval(interval);
  // }, [toast, mutateCurrentPlaying]);

  // Auth is handled by Electron now, no Firebase auth check needed.
  // Assuming admin page is accessible if app is running in Electron.
  useEffect(() => {
    if (!isElectron()) {
      toast({ title: "Error", description: "Esta aplicación está diseñada para Electron.", variant: "destructive" });
      // Optionally redirect or disable functionality
    }
  }, [toast]);


  // Queue Loader and Listener via IPC
  useEffect(() => {
    if (!isElectron()) return;
    setIsLoadingQueue(true);
    getSongQueue().then(result => {
      if (result.success && result.queue) {
        setQueue(result.queue.map(s => ({...s, id: s.spotifyTrackId}))); // Use spotifyTrackId as key if no 'id'
      } else {
        toast({ title: 'Error', description: result.error || 'No se pudo cargar la cola.', variant: 'destructive' });
      }
      setIsLoadingQueue(false);
    });

    const unsubscribe = onSongQueueUpdated((updatedQueue) => {
      setQueue(updatedQueue.map(s => ({...s, id: s.spotifyTrackId})));
      toast({ title: 'Cola actualizada', description: 'La cola de reproducción ha cambiado.' });
    });
    return () => unsubscribe();
  }, [toast]);

  // Config Loader and Listener via IPC
  useEffect(() => {
    if (!isElectron()) return;
    setIsLoadingConfig(true);
    getApplicationSettings().then(result => {
      if (result.success && result.settings) {
        setConfig(result.settings);
        setPlaylistIdInput(result.settings.playlistId || '');
      } else {
        toast({ title: 'Error', description: result.error || 'No se pudo cargar la configuración.', variant: 'destructive' });
      }
      setIsLoadingConfig(false);
    });

    const unsubscribe = onApplicationSettingsUpdated((updatedSettings) => {
      setConfig(updatedSettings);
      setPlaylistIdInput(updatedSettings.playlistId || '');
      toast({ title: 'Configuración actualizada', description: 'Los ajustes han cambiado.' });
    });
    return () => unsubscribe();
  }, [toast]);

  // Playlist Details Fetch
  useEffect(() => {
    if (!config || config.searchMode !== 'playlist' || !config.playlistId) {
      setPlaylistDetails(null);
      setIsLoadingPlaylist(false);
      return;
    }

    const fetchDetails = async () => {
      setIsLoadingPlaylist(true);
      try {
        const res = await fetch(`/api/spotify/playlist-details?playlistId=${config.playlistId}`);
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || `Error ${res.status}`);
        }
        const data: PlaylistDetails = await res.json();
        setPlaylistDetails(data);
      } catch (error: any) {
        console.error('Error fetching playlist details:', error);
        setPlaylistDetails(null);
        toast({
          title: 'Error al Cargar Playlist',
          description:
            error.message === 'Playlist no encontrada'
              ? 'La playlist configurada no existe o no es accesible.'
              : 'No se pudo cargar la información de la playlist.',
          variant: 'destructive',
        });
      } finally {
        setIsLoadingPlaylist(false);
      }
    };
    fetchDetails();
  }, [config, toast]);

  // Spotify Status Check and IPC Listeners for Auth & Devices
  useEffect(() => {
    if (!isElectron()) return;

    const checkTokenAndLoadDevices = async () => {
      const tokenResult = await getValidSpotifyAccessToken();
      const isConnected = tokenResult.success && !!tokenResult.accessToken;
      setSpotifyConnected(isConnected);

      if (tokenResult.requiresLogin) {
         toast({ title: 'Spotify', description: 'Necesitas iniciar sesión con Spotify.', variant: 'destructive' });
      }
      
      if (isConnected) {
        setIsLoadingDevices(true);
        getSpotifyDevices().then(deviceResult => {
          if (deviceResult.success && deviceResult.devices) {
            setAvailableDevices(deviceResult.devices);
            // Auto-select active device if no device is currently set
            if (!config.spotifyDeviceId && deviceResult.devices.some(d => d.is_active)) {
              const activeDevice = deviceResult.devices.find(d => d.is_active);
              if (activeDevice && activeDevice.id) {
                toast({ title: 'Dispositivo Activo Detectado', description: `Se usará ${activeDevice.name} para reproducción.`});
                updateApplicationSettings({ spotifyDeviceId: activeDevice.id });
              }
            }
          } else {
            toast({ title: 'Error Dispositivos', description: deviceResult.error || 'No se pudo cargar los dispositivos de Spotify.', variant: 'destructive' });
          }
          setIsLoadingDevices(false);
        });
      } else {
        setAvailableDevices([]); // Clear devices if not connected
      }
    };
    
    checkTokenAndLoadDevices(); // Initial check

    const unsubAuthSuccess = onSpotifyAuthSuccess(() => {
      toast({ title: 'Spotify Conectado', description: 'Has iniciado sesión con Spotify correctamente.' });
      setSpotifyConnected(true);
      checkTokenAndLoadDevices(); // Reload devices on auth success
    });
    const unsubReauthRequired = onSpotifyReauthRequired(() => {
      toast({ title: 'Autenticación Requerida', description: 'Necesitas volver a iniciar sesión con Spotify.', variant: 'destructive' });
      setSpotifyConnected(false);
      setAvailableDevices([]);
    });
    const unsubDisconnected = onSpotifyDisconnected(() => {
      toast({ title: 'Spotify Desconectado', description: 'Has cerrado la sesión de Spotify.' });
      setSpotifyConnected(false);
      setAvailableDevices([]);
    });

    return () => {
      unsubAuthSuccess();
      unsubReauthRequired();
      unsubDisconnected();
    };
  }, [toast, config.spotifyDeviceId]); // Added config.spotifyDeviceId to dependencies for auto-selection logic


  // Handle Track End Notification - Keep for now, will be refactored or removed in Step 4
  // const handleTrackEndNotification = async (endedTrackId: string | null) => { ... }


  // Remove Song from Queue via IPC
  const handleRemoveSong = async (spotifyTrackId: string) => {
    if (!isElectron()) return;
    const result = await removeSongFromQueue(spotifyTrackId);
    if (result.success) {
      toast({ title: 'Canción eliminada', description: 'La canción ha sido eliminada de la cola.' });
      // UI will update via onSongQueueUpdated listener
    } else {
      toast({ title: 'Error', description: result.error || 'No se pudo eliminar la canción.', variant: 'destructive' });
    }
  };

  // Move Song in Queue - This needs to be re-thought. Electron-store itself doesn't have ordering logic beyond array order.
  // For now, this functionality might be disabled or simplified. The current Firebase implementation relies on an 'order' field.
  // A simple re-ordering would mean setting the whole queue again.
  const handleMove = async (index: number, direction: -1 | 1) => {
    toast({ title: 'Función no disponible', description: 'Reordenar la cola se implementará de otra forma.', variant: 'info' });
    // Implementation would involve:
    // 1. Get current queue
    // 2. Reorder in client
    // 3. Call a new IPC handler like 'set-song-queue' that replaces the entire queue.
    // This is a bit heavy, so deferring for now.
  };

  // Spotify Connect/Disconnect via IPC
  const handleSpotifyAction = async () => {
    if (!isElectron()) return;
    if (spotifyConnected) {
      const result = await spotifyLogout(); // Use new IPC logout
      if (result.success) {
        toast({ title: "Spotify Desconectado", description: result.message || "Has cerrado la sesión de Spotify." });
        // UI update will be handled by onSpotifyDisconnected listener
      } else {
        toast({ title: "Error al Desconectar", description: result.error || "No se pudo cerrar la sesión de Spotify.", variant: "destructive" });
      }
    } else {
      const result = await loginToSpotify();
      if (!result.success) {
        toast({ title: "Error de Conexión", description: result.error || "No se pudo iniciar la conexión con Spotify.", variant: "destructive" });
      }
      // Success is handled by onSpotifyAuthSuccess listener
    }
  };

  // Add Song to Queue via IPC
  const handleAddSong = async (song: Song) => {
    if (!isElectron()) return;

    const exists = queue.some((q) => q.spotifyTrackId === song.spotifyTrackId);
    if (exists) {
      toast({ title: 'Canción repetida', description: 'Esa canción ya está en la cola.', variant: 'destructive' });
      return;
    }

    // Omit 'addedAt' as main process will add it
    const songToAdd: Omit<ElectronSong, 'addedAt'> = {
      spotifyTrackId: song.spotifyTrackId,
      title: song.title,
      artist: song.artist,
      albumArtUrl: song.albumArtUrl || undefined, // Ensure it's undefined if null/empty
    };

    const result = await addSongToQueue(songToAdd);
    if (result.success) {
      toast({ title: 'Canción añadida', description: `${song.title} ha sido añadida a la cola.` });
      setSearchTerm('');
      setSearchResults([]);
      // UI will update via onSongQueueUpdated listener
    } else {
      toast({ title: 'Error', description: result.error || 'No se pudo añadir la canción.', variant: 'destructive' });
    }
  };

  // Search Songs
  const doSearch = useCallback(async () => {
    if (!searchTerm.trim() || !config) {
      setSearchResults([]);
      return;
    }

    if (config.searchMode === 'playlist' && !config.playlistId) {
      toast({
        title: 'Playlist no configurada',
        description: 'Primero configura una playlist.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoadingSearch(true);
    try {
      const params = new URLSearchParams({
        q: searchTerm,
        mode: config.searchMode,
      });
      if (config.searchMode === 'playlist' && config.playlistId) {
        params.append('playlistId', config.playlistId);
      }

      const res = await fetch(`/api/searchSpotify?${params.toString()}`);
      const data = await res.json();
      const results = Array.isArray(data.results) ? data.results : [];
      const songs: Song[] = Array.isArray(results)
        ? results.map((t: any) => ({
            spotifyTrackId: t.spotifyTrackId || t.id,
            title: t.title || t.name,
            artist: Array.isArray(t.artists) ? t.artists.join(', ') : t.artist,
            albumArtUrl: t.albumArtUrl || t.album?.images?.[0]?.url || null,
          }))
        : [];

      setSearchResults(songs);
    } catch (e: any) {
      console.error('Error búsqueda Spotify:', e);
      toast({ title: 'Error', description: e.message });
    } finally {
      setIsLoadingSearch(false);
    }
  }, [searchTerm, config, toast]);

  useEffect(() => {
    const delay = setTimeout(() => {
      if (searchTerm.trim()) {
        doSearch();
      } else {
        setSearchResults([]);
      }
    }, 500);
    return () => clearTimeout(delay);
  }, [searchTerm, doSearch]);

  // Load All Songs from Playlist
  const handleLoadAllSongs = async () => {
    if (!config || config.searchMode !== 'playlist' || !config.playlistId) {
      toast({
        title: 'Error de Configuración',
        description: 'La búsqueda debe estar en modo playlist y con una playlist configurada.',
        variant: 'destructive',
      });
      return;
    }
    setIsLoadingSearch(true);
    try {
      const res = await fetch(`/api/searchSpotify?mode=playlist&playlistId=${config.playlistId}&limit=100`);
      const data = await res.json();
      const results = Array.isArray(data.results) ? data.results : [];
      const songs: Song[] = Array.isArray(results)
        ? results.map((t: any) => ({
            spotifyTrackId: t.spotifyTrackId || t.id,
            title: t.title || t.name,
            artist: Array.isArray(t.artists) ? t.artists.join(', ') : t.artist,
            albumArtUrl: t.albumArtUrl || t.album?.images?.[0]?.url || null,
          }))
        : [];

      setSearchResults(songs);
    } catch (e: any) {
      toast({ title: 'Error al cargar', description: e.message });
    } finally {
      setIsLoadingSearch(false);
    }
  };

  // Save Config via IPC
  const handleConfigSave = async () => {
    if (!isElectron()) return;
    const newSettings: Partial<ElectronSettings> = {
      searchMode: config.searchMode,
      playlistId: playlistIdInput.trim() || null,
      // spotifyDeviceId is not managed here, but preserve it if it exists in current config
      spotifyDeviceId: config.spotifyDeviceId 
    };
    const result = await updateApplicationSettings(newSettings);
    if (result.success) {
      toast({ title: 'Configuración guardada', description: 'Los cambios se han guardado correctamente.' });
      // UI will update via onApplicationSettingsUpdated listener
    } else {
      toast({ title: 'Error', description: result.error || 'No se pudo guardar la configuración.', variant: 'destructive' });
    }
  };

  // Clear Queue via IPC
  const handleClearQueue = async () => {
    if (!isElectron()) return;
    const isConfirmed = window.confirm("¿Estás seguro de que quieres vaciar completamente la cola? Esta acción no se puede deshacer.");
    if (!isConfirmed) return;

    setIsLoadingQueue(true); // Visually indicate loading
    const result = await clearSongQueue();
    if (result.success) {
      toast({ title: 'Cola Vaciada', description: 'Se ha eliminado toda la cola de reproducción.' });
      // UI will update via onSongQueueUpdated listener
    } else {
      toast({ title: 'Error', description: result.error || 'No se pudo vaciar la cola.', variant: 'destructive' });
    }
    // isLoadingQueue will be set to false by the listener or if initial load finishes
  };

  if (isLoadingConfig) { // Removed loadingAuth
    return (
      <div className="flex justify-center items-center min-h-screen">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2">Cargando panel de administración...</p>
      </div>
    );
  }

  // User check removed
  // if (!user) {
  //   return null;
  // }

  return (
    <div className="container mx-auto p-4 flex flex-col min-h-screen">
      <div className="flex flex-col md:flex-row gap-6 flex-1">
        {/* Columna principal */}
        <div className="flex-1 space-y-6">
          {/* ── Ahora Suena ── */}
          <Card className="shadow-lg rounded-lg border border-border/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl font-semibold text-primary flex items-center gap-2">
                <Music className="h-5 w-5" /> Ahora Suena
              </CardTitle>
            </CardHeader>
            <CardContent>
              {currentPlaying && currentPlaying.title ? (
                <div className="flex gap-4 items-center">
                  <Image
                    src={currentPlaying.albumArtUrl || `https://picsum.photos/seed/${currentPlaying.spotifyTrackId}/64`}
                    alt={currentPlaying.title}
                    width={64}
                    height={64}
                    className="rounded-md shadow-md"
                  />
                  <div className="flex-1 overflow-hidden">
                    <p className="font-semibold truncate">{currentPlaying.title}</p>
                    <p className="text-sm text-muted-foreground truncate">{currentPlaying.artist}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Nada está sonando ahora mismo.</p>
              )}
            </CardContent>
          </Card>

          {/* ── Lista de la Cola ── */}
          <Card className="shadow-lg rounded-lg border border-border/70">
            <CardHeader>
              <CardTitle className="text-xl font-semibold text-primary flex items-center gap-2">
                <ListMusic className="h-5 w-5" /> Cola de Reproducción ({queue.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-96">
                {isLoadingQueue ? (
                  <div className="p-4 space-y-3">
                    {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-md" />)}
                  </div>
                ) : queue.length > 0 ? (
                  <div className="divide-y divide-border">
                    {queue.map((song, idx) => (
                        <div key={song.spotifyTrackId} className="flex items-center gap-3 p-3 hover:bg-secondary/20 transition-colors">
                        <span className="w-5 text-sm text-center text-muted-foreground font-medium">{idx + 1}</span>
                        {song.albumArtUrl ? (
                          <Image src={song.albumArtUrl} alt={song.title} width={40} height={40} className="h-10 w-10 rounded object-cover shadow-sm" />
                        ) : (
                          <div className="h-10 w-10 bg-muted rounded flex items-center justify-center shadow-sm">
                            <Music className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 overflow-hidden">
                          <p className="truncate font-medium text-sm">{song.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{song.artist}</p>
                        </div>
                        <div className="flex gap-1.5">
                          <TooltipProvider delayDuration={100}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleMove(idx, -1)} disabled={idx === 0 || true}><ArrowUp /></Button> 
                              </TooltipTrigger>
                              <TooltipContent><p>Mover Arriba (Deshabilitado)</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleMove(idx, 1)} disabled={idx === queue.length - 1 || true}><ArrowDown /></Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Mover Abajo (Deshabilitado)</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleRemoveSong(song.spotifyTrackId)}><Trash2 /></Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Eliminar Canción</p></TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4">
                    <p className="text-center text-muted-foreground py-10 italic">La cola está vacía.</p>
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* ── Buscador de canciones ── */}
          <Card className="shadow-lg rounded-lg border border-border/70">
            <CardHeader>
              <CardTitle className="text-xl font-semibold text-primary flex items-center gap-2">
                <Search className="h-5 w-5" /> Añadir Canciones
              </CardTitle>
              {config.searchMode === 'playlist' && playlistDetails && (
                <div className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
                  <ListVideo className="h-4 w-4" />
                  Playlist:
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a
                          href={playlistDetails.externalUrl || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:underline truncate max-w-[200px]"
                        >
                          {playlistDetails.name}
                        </a>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{playlistDetails.name}</p>
                        {playlistDetails.description && <p className="text-xs text-muted-foreground">{playlistDetails.description}</p>}
                        {playlistDetails.externalUrl && <p className="text-xs text-accent underline mt-1">Abrir en Spotify</p>}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                <Input
                  placeholder="Nombre de canción o artista..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="flex-grow"
                  disabled={isLoadingSearch || (config.searchMode === 'playlist' && !config.playlistId)}
                />
                {config.searchMode === 'playlist' && config.playlistId && (
                  <Button onClick={handleLoadAllSongs} disabled={isLoadingSearch || !config.playlistId}>
                    {isLoadingSearch && searchTerm === '' ? <RefreshCw className="animate-spin h-4 w-4" /> : <ListMusic className="h-4 w-4" />}
                    <span className="ml-2 hidden sm:inline">Ver Todas</span>
                  </Button>
                )}
              </div>
              <ScrollArea className="h-72 border rounded-md">
                <div className="p-2 space-y-1">
                  {isLoadingSearch ? (
                    [...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)
                  ) : searchResults.length > 0 ? (
                    searchResults.map((song) => (
                      <div
                        key={song.spotifyTrackId}
                        className="flex items-center justify-between p-2 rounded-md hover:bg-secondary/20 transition-colors"
                      >
                        <div className="flex items-center gap-3 overflow-hidden flex-1">
                          {song.albumArtUrl ? (
                            <Image src={song.albumArtUrl} width={32} height={32} className="w-8 h-8 rounded object-cover" alt={song.title} />
                          ) : (
                            <div className="w-8 h-8 bg-muted flex items-center justify-center rounded">
                              <Music className="text-muted-foreground h-4 w-4" />
                            </div>
                          )}
                          <div className="truncate">
                            <p className="font-medium text-sm truncate">{song.title}</p>
                            <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
                          </div>
                        </div>
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleAddSong(song)} disabled={queue.some(s => s.spotifyTrackId === song.spotifyTrackId) || !isElectron()}>
                                <PlusCircle />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>{queue.some(s => s.spotifyTrackId === song.spotifyTrackId) ? 'Ya en cola' : 'Añadir a la cola'}</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    ))
                  ) : searchTerm ? (
                    <p className="text-center text-sm text-muted-foreground py-4 italic">No se encontraron resultados para "{searchTerm}".</p>
                  ) : (
                    <p className="text-center text-sm text-muted-foreground py-4 italic">
                      {config.searchMode === 'playlist' && !config.playlistId ? 'Configure una playlist para buscar o ver todas las canciones.' : 'Busca una canción o artista.'}
                    </p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Columna lateral */}
        <div className="w-full md:w-96 space-y-6">
          <Card className="shadow-lg rounded-lg border border-border/70">
            <CardHeader>
              <CardTitle className="text-xl font-semibold text-primary flex items-center gap-2">
                <Settings className="h-5 w-5" /> Configuración
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label htmlFor="search-mode-toggle" className="text-base font-medium mb-2 block">Modo de Búsqueda</Label>
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-md">
                  <Switch
                    id="search-mode-toggle"
                    checked={config.searchMode === 'playlist'}
                    onCheckedChange={(checked) => {
                      setConfig(prev => ({ ...prev, searchMode: checked ? 'playlist' : 'all' }));
                    }}
                    aria-label="Cambiar modo de búsqueda"
                  />
                  <Label htmlFor="search-mode-toggle" className="cursor-pointer flex-1">
                    {config.searchMode === 'playlist' ? 'Solo en Playlist Especificada' : 'En todo Spotify'}
                  </Label>
                </div>
              </div>

              {config.searchMode === 'playlist' && (
                <div>
                  <Label htmlFor="playlist-id-input" className="text-base font-medium mb-2 block">ID de la Playlist de Spotify</Label>
                  <Input
                    id="playlist-id-input"
                    placeholder="Ej: 37i9dQZF1DXcBWIGoYBM5M"
                    value={playlistIdInput}
                    onChange={(e) => setPlaylistIdInput(e.target.value)}
                    className="text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Pega el ID de la playlist de Spotify aquí.</p>
                </div>
              )}
              <Button onClick={handleConfigSave} className="w-full mt-2">
                Guardar Configuración
              </Button>

              <hr className="my-4 border-border" />

              <div>
                <Label className="text-base font-medium mb-2 block">Conexión con Spotify</Label>
                <div className="space-y-2">
                  <Button
                    onClick={handleSpotifyAction}
                    variant={spotifyConnected ? 'destructive' : 'default'}
                    className="w-full"
                    disabled={!isElectron()}
                  >
                    {spotifyConnected ? <><LogOut className="mr-2 h-4 w-4" /> Desconectar Spotify</> : <><ExternalLink className="mr-2 h-4 w-4" /> Conectar Spotify</>}
                  </Button>
                  {isElectron() && spotifyConnected && (
                     <p className="text-xs text-green-600">Spotify está conectado. Para cambiar de cuenta, desconecta y vuelve a conectar.</p>
                  )}
                   {!isElectron() && (
                    <p className="text-xs text-red-600">La aplicación no se está ejecutando en Electron. Funcionalidad de Spotify limitada.</p>
                  )}
                </div>
              </div>
              
              {isElectron() && spotifyConnected && (
              <div>
                <Label htmlFor="spotify-device-select" className="text-base font-medium mb-2 block">Dispositivo de Reproducción</Label>
                {isLoadingDevices ? (
                  <Skeleton className="h-10 w-full" />
                ) : availableDevices.length > 0 ? (
                  <div className="flex gap-2">
                    <select
                      id="spotify-device-select"
                      value={config.spotifyDeviceId || ''}
                      onChange={async (e) => {
                        const newDeviceId = e.target.value;
                        // Optimistic update for immediate UI feedback
                        setConfig(prev => ({ ...prev, spotifyDeviceId: newDeviceId })); 
                        const result = await updateApplicationSettings({ spotifyDeviceId: newDeviceId });
                        if (result.success && result.settings) {
                           // Ensure UI is consistent with stored settings, though onApplicationSettingsUpdated should also handle this.
                          setConfig(result.settings); 
                          toast({ title: 'Dispositivo Guardado', description: `Reproducción configurada en ${availableDevices.find(d=>d.id === newDeviceId)?.name || 'dispositivo desconocido'}.` });
                        } else {
                          toast({ title: 'Error', description: 'No se pudo guardar el dispositivo.', variant: 'destructive' });
                           // Revert optimistic update if needed, or rely on onApplicationSettingsUpdated to correct it
                           // For simplicity, we assume onApplicationSettingsUpdated will eventually set the correct state.
                        }
                      }}
                      className="block w-full p-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                    >
                      <option value="" disabled>Selecciona un dispositivo</option>
                      {availableDevices.map(device => (
                        <option key={device.id || 'unknown-device-' + Math.random()} value={device.id || ''} disabled={!device.id || device.is_restricted}>
                          {device.name} ({device.type}) {device.is_active ? ' (Activo)' : ''} {device.is_restricted ? ' (Restringido)' : ''}
                        </option>
                      ))}
                    </select>
                    <Button variant="outline" size="icon" onClick={async () => {
                       setIsLoadingDevices(true);
                        const deviceResult = await getSpotifyDevices();
                        if (deviceResult.success && deviceResult.devices) {
                          setAvailableDevices(deviceResult.devices);
                        } else {
                          toast({ title: 'Error Dispositivos', description: deviceResult.error || 'No se pudo refrescar los dispositivos.', variant: 'destructive' });
                        }
                        setIsLoadingDevices(false);
                    }} title="Refrescar dispositivos">
                      <RefreshCw className={`h-4 w-4 ${isLoadingDevices ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No hay dispositivos de Spotify disponibles. Asegúrate de que Spotify esté activo en algún dispositivo y luego refresca.</p>
                )}
                {config.spotifyDeviceId && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Reproduciendo en: {availableDevices.find(d => d.id === config.spotifyDeviceId)?.name || config.spotifyDeviceId}
                  </p>
                )}
              </div>
              )}

            </CardContent>
            <CardFooter className="flex flex-col gap-2 pt-4 border-t">
              <Button variant="outline" disabled className="w-full opacity-80 cursor-default">
                🗳️ Modo Votos: Off
              </Button>

              <Button variant="outline" onClick={() => router.push('/')} className="w-full">
                <Home className="mr-2 h-4 w-4" /> Ir al Jukebox
              </Button>
              {/* Sign out button and "Forzar Sincronización" button removed as their original Firebase-dependent logic is obsolete */}
              <Button
                variant="destructive"
                className="w-full"
                onClick={handleClearQueue}
                disabled={queue.length === 0 || isLoadingQueue || !isElectron()}
              >
                {isLoadingQueue ? <RefreshCw className="animate-spin mr-2 h-4 w-4" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Vaciar Cola ({queue.length})
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
      <footer className="w-full text-center text-muted-foreground text-sm p-4 mt-auto">
        Version: {process.env.NEXT_PUBLIC_APP_VERSION}
      </footer>
    </div>
  );
}