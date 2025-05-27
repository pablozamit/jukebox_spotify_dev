'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
// Firebase Auth and DB imports removed
import { useToast } from '@/hooks/use-toast';
// import useSWR from 'swr'; // No longer used
import {
  // IPC Methods from the new wrapper
  loginToSpotify,
  getCurrentPlaying, // Added
  getPlaylistDetails as ipcGetPlaylistDetails, // Added and aliased
  searchSpotifyLocally, // Added
  CurrentlyPlayingTrack, // Added
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
  SpotifyDevice, // Import type
  setSpotifyCredentials, // Added for new UI section
} from '@/lib/electron-ipc';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
// PlaylistDetails is now also imported from electron-ipc, ensure no conflict or use alias if local one is different
// For now, assuming the IPC one will replace the local one if structures match.
// import { PlaylistDetails } from '@/lib/electron-ipc'; // Already defined locally, check structure
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


// Local PlaylistDetails might conflict if structure is different from IPC one.
// For now, assuming IPC one is desired. If not, one needs to be aliased.
// interface PlaylistDetails {
//   name: string;
//   description: string;
//   imageUrl: string | null;
//   externalUrl?: string;
// }
// Using PlaylistDetails from electron-ipc

// interface SpotifyStatus { // This interface seems unused, can be removed
//   spotifyConnected: boolean;
//   tokensOk: boolean;
//   playbackAvailable: boolean;
//   activeDevice?: { id: string; name: string; type: string };
//   message?: string;
// }

// const fetcher = async (url: string) => { // fetcher is no longer needed
//   const res = await fetch(url);
//   if (!res.ok) throw new Error('Error al cargar datos.');
//   return res.json();
// };

export default function AdminPage() {
  const router = useRouter();
  const { toast } = useToast();
  // const isSyncingRef = useRef(false); // This was for the removed syncInterval

  const [queue, setQueue] = useState<QueueSong[]>([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState(true);
  const [config, setConfig] = useState<SpotifyConfig>({ searchMode: 'all', playlistId: null, spotifyDeviceId: null });
  const [playlistIdInput, setPlaylistIdInput] = useState('');
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  
  const [spotifyConnected, setSpotifyConnected] = useState(false); 
  const [playlistDetails, setPlaylistDetails] = useState<import('@/lib/electron-ipc').PlaylistDetails | null>(null); // Use IPC type
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]); // Song type is local, ensure it matches searchSpotifyLocally results
  const [isLoadingSearch, setIsLoadingSearch] = useState(false);
  const [availableDevices, setAvailableDevices] = useState<SpotifyDevice[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);

  const [currentPlaying, setCurrentPlaying] = useState<CurrentlyPlayingTrack | null>(null);
  const [isLoadingCurrentPlaying, setIsLoadingCurrentPlaying] = useState(true);

  // State for Spotify credential inputs
  const [spotifyClientIdInput, setSpotifyClientIdInput] = useState('');
  const [spotifyClientSecretInput, setSpotifyClientSecretInput] = useState('');
  const [isSavingCredentials, setIsSavingCredentials] = useState(false);


  // Fetch Currently Playing Song via IPC
  useEffect(() => {
    if (!isElectron()) return;

    const fetchCurrentPlaying = async () => {
      // setIsLoadingCurrentPlaying(true); // Set loading true at the start of fetch
      const result = await getCurrentPlaying();
      if (result.success && result.data) {
        setCurrentPlaying(result.data);
      } else {
        setCurrentPlaying(null); // Set to null or a default "not playing" state
        if (result.errorType !== 'SPOTIFY_API_UNAVAILABLE') { // Don't toast for frequent unavailability errors
          // toast({ title: 'Error Pista Actual', description: result.message || result.error || 'No se pudo obtener la canción actual.', variant: 'destructive' });
        }
        console.error("Error fetching current playing:", result.message || result.error);
      }
      setIsLoadingCurrentPlaying(false);
    };

    fetchCurrentPlaying(); // Initial fetch
    const intervalId = setInterval(fetchCurrentPlaying, 5000); // Poll every 5 seconds

    return () => clearInterval(intervalId); // Cleanup interval on unmount
  }, [toast]);

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
      // toast({ title: 'Cola actualizada', description: 'La cola de reproducción ha cambiado.' }); // Can be too noisy
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
      // toast({ title: 'Configuración actualizada', description: 'Los ajustes han cambiado.' }); // Can be too noisy
    });
    return () => unsubscribe();
  }, [toast]);

  // Playlist Details Fetch via IPC
  useEffect(() => {
    if (!isElectron() || !config || config.searchMode !== 'playlist' || !config.playlistId) {
      setPlaylistDetails(null);
      setIsLoadingPlaylist(false);
      return;
    }

    const fetchDetails = async () => {
      setIsLoadingPlaylist(true);
      const result = await ipcGetPlaylistDetails(config.playlistId as string); // Ensure playlistId is not null
      if (result.success && result.data) {
        setPlaylistDetails(result.data);
      } else {
        setPlaylistDetails(null);
        toast({
          title: 'Error al Cargar Playlist',
          description: result.message || result.error || 'No se pudo cargar la información de la playlist.',
          variant: 'destructive',
        });
        console.error('Error fetching playlist details via IPC:', result.message || result.error);
      }
      setIsLoadingPlaylist(false);
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
            if (!config.spotifyDeviceId && deviceResult.devices.some(d => d.is_active)) {
              const activeDevice = deviceResult.devices.find(d => d.is_active);
              if (activeDevice && activeDevice.id) {
                toast({ title: 'Dispositivo Activo Detectado', description: `Se usará ${activeDevice.name} para reproducción.` });
                updateApplicationSettings({ spotifyDeviceId: activeDevice.id });
              }
            }
          } else {
            toast({ title: 'Error Dispositivos', description: deviceResult.error || 'No se pudo cargar los dispositivos de Spotify.', variant: 'destructive' });
          }
          setIsLoadingDevices(false);
        });
      } else {
        setAvailableDevices([]);
      }
    };
    
    checkTokenAndLoadDevices();

    const unsubAuthSuccess = onSpotifyAuthSuccess(() => {
      toast({ title: 'Spotify Conectado', description: 'Has iniciado sesión con Spotify correctamente.' });
      setSpotifyConnected(true);
      checkTokenAndLoadDevices();
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
  }, [toast, config.spotifyDeviceId]);


  // Remove Song from Queue via IPC
  const handleRemoveSong = async (spotifyTrackId: string) => {
    if (!isElectron()) return;
    const result = await removeSongFromQueue(spotifyTrackId);
    if (result.success) {
      toast({ title: 'Canción eliminada', description: 'La canción ha sido eliminada de la cola.' });
    } else {
      toast({ title: 'Error', description: result.error || 'No se pudo eliminar la canción.', variant: 'destructive' });
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    toast({ title: 'Función no disponible', description: 'Reordenar la cola se implementará de otra forma.', variant: 'info' });
  };

  // Spotify Connect/Disconnect via IPC
  const handleSpotifyAction = async () => {
    if (!isElectron()) return;
    if (spotifyConnected) {
      const result = await spotifyLogout();
      if (result.success) {
        toast({ title: "Spotify Desconectado", description: result.message || "Has cerrado la sesión de Spotify." });
      } else {
        toast({ title: "Error al Desconectar", description: result.error || "No se pudo cerrar la sesión de Spotify.", variant: "destructive" });
      }
    } else {
      const result = await loginToSpotify();
      if (!result.success) {
        toast({ title: "Error de Conexión", description: result.error || "No se pudo iniciar la conexión con Spotify.", variant: "destructive" });
      }
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
    const songToAdd: Omit<ElectronSong, 'addedAt'> = {
      spotifyTrackId: song.spotifyTrackId,
      title: song.title,
      artist: song.artist,
      albumArtUrl: song.albumArtUrl || undefined,
    };
    const result = await addSongToQueue(songToAdd);
    if (result.success) {
      toast({ title: 'Canción añadida', description: `${song.title} ha sido añadida a la cola.` });
      setSearchTerm('');
      setSearchResults([]);
    } else {
      toast({ title: 'Error', description: result.error || 'No se pudo añadir la canción.', variant: 'destructive' });
    }
  };

  // Search Songs via IPC
  const doSearch = useCallback(async () => {
    if (!isElectron() || !searchTerm.trim() || !config) {
      setSearchResults([]);
      return;
    }
    if (config.searchMode === 'playlist' && !config.playlistId) {
      toast({ title: 'Playlist no configurada', description: 'Primero configura una playlist.', variant: 'destructive' });
      return;
    }
    setIsLoadingSearch(true);
    const result = await searchSpotifyLocally({
      searchTerm: searchTerm,
      searchMode: config.searchMode,
      playlistId: config.playlistId,
      // limit: 20 // Example limit, adjust as needed
    });
    if (result.success && result.results) {
      // Assuming result.results are already in the local Song format or compatible
      setSearchResults(result.results as Song[]);
    } else {
      setSearchResults([]);
      toast({ title: 'Error de Búsqueda', description: result.error || 'No se pudieron buscar canciones.', variant: 'destructive' });
      console.error("Error searching Spotify via IPC:", result.error);
    }
    setIsLoadingSearch(false);
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

  // Load All Songs from Playlist via IPC
  const handleLoadAllSongs = async () => {
    if (!isElectron() || !config || config.searchMode !== 'playlist' || !config.playlistId) {
      toast({ title: 'Error de Configuración', description: 'La búsqueda debe estar en modo playlist y con una playlist configurada.', variant: 'destructive' });
      return;
    }
    setIsLoadingSearch(true);
    // Call searchSpotifyLocally with empty searchTerm to get all playlist tracks
    // The main process handler for searchSpotifyLocally should be designed to return all tracks
    // from the specified playlistId when searchTerm is empty or null.
    const result = await searchSpotifyLocally({
      searchTerm: '', // Empty search term implies loading all from playlist
      searchMode: 'playlist',
      playlistId: config.playlistId,
      // limit: 100 // Example: if the IPC handler supports a limit for "all songs"
    });
    if (result.success && result.results) {
      setSearchResults(result.results as Song[]);
    } else {
      setSearchResults([]);
      toast({ title: 'Error al Cargar Playlist', description: result.error || 'No se pudo cargar la playlist.', variant: 'destructive' });
      console.error("Error loading all songs from playlist via IPC:", result.error);
    }
    setIsLoadingSearch(false);
  };

  // Save Config via IPC
  const handleConfigSave = async () => {
    if (!isElectron()) return;
    const newSettings: Partial<ElectronSettings> = {
      searchMode: config.searchMode,
      playlistId: playlistIdInput.trim() || null,
      spotifyDeviceId: config.spotifyDeviceId 
    };
    const result = await updateApplicationSettings(newSettings);
    if (result.success) {
      toast({ title: 'Configuración guardada', description: 'Los cambios se han guardado correctamente.' });
    } else {
      toast({ title: 'Error', description: result.error || 'No se pudo guardar la configuración.', variant: 'destructive' });
    }
  };

  // Clear Queue via IPC
  const handleClearQueue = async () => {
    if (!isElectron()) return;
    const isConfirmed = window.confirm("¿Estás seguro de que quieres vaciar completamente la cola? Esta acción no se puede deshacer.");
    if (!isConfirmed) return;

    setIsLoadingQueue(true);
    const result = await clearSongQueue();
    if (result.success) {
      toast({ title: 'Cola Vaciada', description: 'Se ha eliminado toda la cola de reproducción.' });
    } else {
      toast({ title: 'Error', description: result.error || 'No se pudo vaciar la cola.', variant: 'destructive' });
    }
    // isLoadingQueue state will be managed by the queue listener or initial load effect
  };

  const handleSaveCredentials = async () => {
    if (!isElectron()) {
      toast({ title: 'Error', description: 'Esta función solo está disponible en Electron.', variant: 'destructive' });
      return;
    }
    if (!spotifyClientIdInput.trim() || !spotifyClientSecretInput.trim()) {
      toast({ title: 'Error', description: 'Client ID y Client Secret son requeridos.', variant: 'destructive' });
      return;
    }
    setIsSavingCredentials(true);
    const result = await setSpotifyCredentials(spotifyClientIdInput, spotifyClientSecretInput);
    if (result.success) {
      toast({ title: 'Credenciales Guardadas', description: result.message || 'Las credenciales de Spotify se han guardado.' });
      // Optionally clear inputs after saving, or fetch and display the stored client ID (masked)
      // setSpotifyClientIdInput(''); // Example: Clear input after save
      // setSpotifyClientSecretInput(''); // Example: Clear input after save
    } else {
      toast({ title: 'Error al Guardar', description: result.error || 'No se pudieron guardar las credenciales.', variant: 'destructive' });
    }
    setIsSavingCredentials(false);
  };

  if (isLoadingConfig || isLoadingCurrentPlaying) { 
    return (
      <div className="flex justify-center items-center min-h-screen">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2">Cargando panel de administración...</p>
      </div>
    );
  }

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
              {isLoadingCurrentPlaying ? (
                <Skeleton className="h-16 w-full" />
              ) : currentPlaying && currentPlaying.isPlaying && currentPlaying.title ? (
                <div className="flex gap-4 items-center">
                  <Image
                    src={currentPlaying.albumArtUrl || `https://picsum.photos/seed/${currentPlaying.spotifyTrackId}/64`}
                    alt={currentPlaying.title || 'Album art'}
                    width={64}
                    height={64}
                    className="rounded-md shadow-md"
                  />
                  <div className="flex-1 overflow-hidden">
                    <p className="font-semibold truncate">{currentPlaying.title}</p>
                    <p className="text-sm text-muted-foreground truncate">{currentPlaying.artist}</p>
                    {/* Optional: Progress bar if IPC provides progress_ms and duration_ms */}
                    {currentPlaying.progress_ms !== undefined && currentPlaying.duration_ms !== undefined && currentPlaying.duration_ms > 0 && (
                       <progress value={currentPlaying.progress_ms} max={currentPlaying.duration_ms} className="w-full mt-1 h-1 [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary" />
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Nada está sonando ahora mismo o el reproductor no está activo.</p>
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
                    }} title="Refrescar dispositivos" disabled={!isElectron() || isLoadingDevices}>
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

              <hr className="my-4 border-border" />
              
              {/* Spotify API Credentials Section */}
              <div>
                <Label className="text-base font-medium mb-2 block">Credenciales API Spotify</Label>
                {!isElectron() ? (
                  <p className="text-xs text-red-600 p-3 bg-destructive/10 rounded-md">
                    La configuración de credenciales solo está disponible cuando la aplicación se ejecuta en Electron.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="spotify-client-id" className="text-sm font-normal">Spotify Client ID</Label>
                      <Input
                        id="spotify-client-id"
                        type="text"
                        placeholder="Tu Spotify Client ID"
                        value={spotifyClientIdInput}
                        onChange={(e) => setSpotifyClientIdInput(e.target.value)}
                        disabled={isSavingCredentials}
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <Label htmlFor="spotify-client-secret" className="text-sm font-normal">Spotify Client Secret</Label>
                      <Input
                        id="spotify-client-secret"
                        type="password"
                        placeholder="Tu Spotify Client Secret"
                        value={spotifyClientSecretInput}
                        onChange={(e) => setSpotifyClientSecretInput(e.target.value)}
                        disabled={isSavingCredentials}
                        className="text-xs"
                      />
                    </div>
                    <Button onClick={handleSaveCredentials} className="w-full" disabled={isSavingCredentials || !spotifyClientIdInput || !spotifyClientSecretInput}>
                      {isSavingCredentials ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Guardar Credenciales
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Estas credenciales se almacenan de forma segura en tu dispositivo.
                      Se utilizan para autenticar la aplicación con Spotify.
                    </p>
                  </div>
                )}
              </div>

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