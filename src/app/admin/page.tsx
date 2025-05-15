
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { ref, onValue, remove, update, push, set, serverTimestamp, get } from 'firebase/database';
import { auth, db, isDbValid } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import useSWR from 'swr';
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

interface QueueSong {
  id: string;
  spotifyTrackId: string;
  title: string;
  artist: string;
  albumArtUrl?: string;
  order?: number;
  addedByUserId?: string;
  timestampAdded: number;
  votes?: number;
}

interface Song {
  spotifyTrackId: string;
  title: string;
  artist: string;
  albumArtUrl?: string;
}

interface SpotifyConfig {
  searchMode: 'playlist' | 'all';
  playlistId?: string;
  spotifyConnected?: boolean;
}

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

  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [queue, setQueue] = useState<QueueSong[]>([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState(true);
  const [config, setConfig] = useState<SpotifyConfig>({ searchMode: 'all' });
  const [playlistIdInput, setPlaylistIdInput] = useState('');
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [sdkPlaybackState, setSdkPlaybackState] = useState<any>(null);
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatus | null>(null);
  const [spotifyAccessToken, setSpotifyAccessToken] = useState<string | null>(null);
  const [playlistDetails, setPlaylistDetails] = useState<PlaylistDetails | null>(null);
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [isLoadingSearch, setIsLoadingSearch] = useState(false);

  const { data: currentPlaying, mutate: mutateCurrentPlaying } = useSWR('/api/spotify/current', fetcher, { refreshInterval: 3000 });

  // Authentication Check
  useEffect(() => {
    if (!auth) {
      setLoadingAuth(false);
      router.push('/admin/login');
      return;
    }
    const unsub = onAuthStateChanged(auth, (current) => {
      if (current) setUser(current);
      else router.push('/admin/login');
      setLoadingAuth(false);
    });
    return () => unsub();
  }, [router]);

  // Queue Listener
  useEffect(() => {
    if (!db || !user) {
      setIsLoadingQueue(false);
      return;
    }
    try {
      const queueRef = ref(db, '/queue');
      setIsLoadingQueue(true);
      const unsub = onValue(queueRef, (snapshot) => {
        try {
          const data = snapshot.val() || {};
          const items = Object.entries(data)
            .map(([key, val]) => {
              if (
                !val ||
                typeof val !== 'object' ||
                typeof (val as any).title !== 'string' ||
                typeof (val as any).artist !== 'string' ||
                typeof (val as any).spotifyTrackId !== 'string'
              ) {
                return null;
              }
              return {
                id: key,
                ...(val as any),
                order: (val as any).order ?? (val as any).timestampAdded ?? 0,
                timestampAdded: (val as any).timestampAdded ?? 0
              };
            })
            .filter((item): item is QueueSong => item !== null)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

          setQueue(items);
        } catch (error) {
          console.error('Error processing queue data:', error);
          toast({ title: 'Error', description: 'Error al procesar la cola de reproducción.' });
        } finally {
          setIsLoadingQueue(false);
        }
      });
      return () => unsub();
    } catch (error) {
      console.error('Error in queue onValue setup:', error);
    }
  }, [user, toast]);

  // Config Listener
  useEffect(() => {
    if (!db || !user) {
      setIsLoadingConfig(false);
      return;
    }
    try {
      const cfgRef = ref(db, '/config');
      setIsLoadingConfig(true);
      const unsub = onValue(cfgRef, (snapshot) => {
        try {
          const data = snapshot.val() || { searchMode: 'all' };
          setConfig({ searchMode: data.searchMode, playlistId: data.playlistId, spotifyConnected: data.spotifyConnected });
          setPlaylistIdInput(data.playlistId || '');
        } catch (error) {
          console.error('Error processing config data:', error);
          toast({ title: 'Error', description: 'Error al procesar la configuración.' });
        } finally {
          setIsLoadingConfig(false);
        }
      });
      return () => unsub();
    } catch (error) {
      console.error('Error in config onValue setup:', error);
    }
  }, [user, toast]);

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

  // Spotify Status Check
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/spotify/status');
        const json = await res.json();
        if (
          typeof json.spotifyConnected === 'boolean' &&
          typeof json.tokensOk === 'boolean' &&
          typeof json.playbackAvailable === 'boolean'
        ) {
          setSpotifyStatus(json as SpotifyStatus);
        } else {
          throw new Error('Respuesta de /api/spotify/status no tiene el formato esperado');
        }
        if (db && json.spotifyConnected) {
          update(ref(db, '/config'), { spotifyConnected: true });
        } else if (db && !json.spotifyConnected) {
          update(ref(db, '/config'), { spotifyConnected: false });
        }
      } catch (e) {
        console.error('Error al consultar estado de Spotify:', e);
        setSpotifyStatus(null);
        if (db) {
          update(ref(db, '/config'), { spotifyConnected: false });
        }
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, [db]);

  // Handle Track End Notification
  const handleTrackEndNotification = async (endedTrackId: string | null) => {
    console.log('Canción terminada, gestionando siguiente y notificando backend...');

    if (!endedTrackId) {
      console.warn('handleTrackEndNotification called without endedTrackId');
    }

    // 1. Notificar al backend para eliminar la canción anterior
    if (endedTrackId) {
      try {
        const res = await fetch('/api/playback/track-ended', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ endedTrackId }),
        });

        const json = await res.json();

        if (json.success) {
          console.log(`Backend notificado correctamente de la canción terminada: ${endedTrackId}.`);
        } else {
          console.error('Error al notificar al backend:', json.error);
          toast({ title: 'Error', description: 'Error al notificar al backend sobre el fin de la canción.', variant: 'destructive' });
        }
      } catch (error) {
        console.error('Error en la llamada a /api/playback/track-ended:', error);
        toast({ title: 'Error', description: 'Error de red al notificar al backend.', variant: 'destructive' });
      }
    } else {
      console.warn('Skipping backend notification: No endedTrackId provided.');
    }

    // 2. Gestionar la siguiente canción de la cola (si existe)
    const nextSong = queue[0]; // El primer elemento de la cola es el siguiente a sonar

    if (nextSong) {
      const trackUri = `spotify:track:${nextSong.spotifyTrackId}`;
      if (!trackUri || !trackUri.startsWith('spotify:track:')) {
        toast({
          title: 'Error en URI',
          description: 'La URI de la siguiente canción no es válida.',
          variant: 'destructive',
        });
        return;
      }

      try {
        // Notificar al backend para transferir la reproducción (sin depender del SDK directamente aquí)
        await fetch('/api/spotify/transfer-playback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackUri }),
        });

        toast({
          title: '🎵 Reproduciendo siguiente canción',
          description: `Ahora suena: ${nextSong.title}`,
        });
      } catch (error: any) {
        console.error('Error al gestionar la siguiente canción:', error);
        toast({ title: 'Error de Reproducción', description: `No se pudo reproducir ${nextSong.title}.`, variant: 'destructive' });
      }
    } else {
      console.log('La cola está vacía. No hay siguiente canción para reproducir.');
      toast({ title: 'Cola vacía', description: 'La cola de reproducción ha terminado.' });
    }

    // Mutar SWR para actualizar "Ahora Suena" si no usamos sdkPlaybackState
    mutateCurrentPlaying();
  };

  // Remove Song from Queue
  const handleRemoveSong = async (songId: string) => {
    if (!db) return;
    try {
      const songRef = ref(db, `/queue/${songId}`);
      const songSnapshot = await get(songRef);
      if (!songSnapshot.exists()) {
        toast({ title: 'Error', description: 'La canción no existe en la cola.', variant: 'destructive' });
        return;
      }
      await remove(songRef);
      toast({ title: 'Canción eliminada', description: 'La canción ha sido eliminada de la cola.' });
    } catch (e: any) {
      console.error('Error eliminando canción:', e);
      toast({ title: 'Error', description: 'No se pudo eliminar la canción.', variant: 'destructive' });
    }
  };

  // Move Song in Queue
  const handleMove = async (index: number, direction: -1 | 1) => {
    if (!db) return;
    const newQueue = [...queue];
    const target = index + direction;
    if (target < 0 || target >= newQueue.length) return;
    [newQueue[index], newQueue[target]] = [newQueue[target], newQueue[index]];

    const updates: Record<string, any> = {};
    newQueue.forEach((song, i) => {
      updates[`/queue/${song.id}/order`] = i * 1000;
    });

    try {
      await update(ref(db), updates);
      toast({ title: 'Orden actualizado', description: 'El orden de la canción ha cambiado.' });
    } catch (error) {
      console.error("Error updating queue order:", error);
      toast({ title: 'Error', description: 'Error al actualizar el orden de la cola.' });
    }
  };

  // Spotify Connect/Disconnect
  const handleSpotifyAction = async () => {
    if (spotifyStatus?.spotifyConnected) {
      try {
        await fetch('/api/spotify/disconnect', { method: 'POST' });
        setSpotifyStatus(prev => prev ? { ...prev, spotifyConnected: false, tokensOk: false, playbackAvailable: false } : null);
        if (db) update(ref(db, '/config'), { spotifyConnected: false });
        if (db) remove(ref(db, '/admin/spotify/tokens'));
        toast({ title: "Spotify Desconectado", description: "Se han borrado los tokens de Spotify." });
      } catch (e) {
        toast({ title: "Error", description: "No se pudo desconectar Spotify.", variant: "destructive" });
      }
    } else {
      window.location.href = '/api/spotify/connect';
    }
  };

  // Add Song to Queue
  const handleAddSong = async (song: Song) => {
    if (!db || !user) return;

    const exists = queue.some((q) => q.spotifyTrackId === song.spotifyTrackId);
    if (exists) {
      toast({
        title: 'Canción repetida',
        description: 'Esa canción ya está en la cola.',
        variant: 'destructive',
      });
      return;
    }

    const qRef = ref(db, '/queue');
    const newRef = push(qRef);
    const maxOrder = queue.length > 0 ? Math.max(...queue.map((i) => i.order ?? 0)) : 0;

    await set(newRef, {
      ...song,
      timestampAdded: serverTimestamp(),
      order: maxOrder + 1000,
      addedByUserId: user?.uid || 'admin',
      albumArtUrl: song.albumArtUrl || null,
    });

    toast({
      title: 'Canción añadida',
      description: `${song.title} ha sido añadida a la cola por el admin.`,
    });
    setSearchTerm('');
    setSearchResults([]);
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

  // Save Config
  const handleConfigSave = async () => {
    if (!db) return;
    try {
      await update(ref(db, '/config'), {
        searchMode: config.searchMode,
        playlistId: playlistIdInput.trim() || null,
      });
      toast({ title: 'Configuración guardada', description: 'Los cambios se han guardado correctamente.' });
    } catch (error) {
      console.error("Error saving config:", error);
      toast({ title: 'Error', description: 'No se pudo guardar la configuración.', variant: 'destructive' });
    }
  };

  // Clear Queue
  const handleClearQueue = async () => {
    if (!db) return;
    const isConfirmed = window.confirm("¿Estás seguro de que quieres vaciar completamente la cola? Esta acción no se puede deshacer.");
    if (!isConfirmed) return;

    setIsLoadingQueue(true);
    try {
      const queueRef = ref(db, '/queue');
      await remove(queueRef);
      toast({
        title: 'Cola Vaciada',
        description: 'Se ha eliminado toda la cola de reproducción.',
      });
    } catch (error: any) {
      console.error('Error clearing queue:', error);
      toast({ title: 'Error', description: 'No se pudo vaciar la cola.', variant: 'destructive' });
    } finally {
      setIsLoadingQueue(false);
    }
  };

  if (loadingAuth || isLoadingConfig) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2">Cargando panel de administración...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Detectar nueva canción y notificar automáticamente
const [lastTrackId, setLastTrackId] = useState<string | null>(null);

useEffect(() => {
  const currentTrackId = sdkPlaybackState?.track_window?.current_track?.id;

  if (!currentTrackId || typeof currentTrackId !== 'string') return;

  if (lastTrackId !== currentTrackId) {
    console.log('[Jukebox] Track ha cambiado:', lastTrackId, '->', currentTrackId);
    setLastTrackId(currentTrackId);
    handleTrackEndNotification(currentTrackId);
  }
}, [sdkPlaybackState?.track_window?.current_track?.id]);

  return (
    <div className="container mx-auto p-4 flex flex-col min-h-screen">
      {/* Spotify Playback SDK Integration */}

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
              {sdkPlaybackState && sdkPlaybackState.track_window && sdkPlaybackState.track_window.current_track ? (
                <div className="flex gap-4 items-center">
                  <Image
                    src={sdkPlaybackState.track_window.current_track.album.images[0]?.url || `https://picsum.photos/seed/${sdkPlaybackState.track_window.current_track.id}/64`}
                    alt={sdkPlaybackState.track_window.current_track.name}
                    width={64}
                    height={64}
                    className="rounded-md shadow-md"
                    data-ai-hint="song album"
                  />
                  <div className="flex-1 overflow-hidden">
                    <p className="font-semibold truncate">{sdkPlaybackState.track_window.current_track.name}</p>
                    <p className="text-sm text-muted-foreground truncate">{sdkPlaybackState.track_window.current_track.artists.map((a: any) => a.name).join(', ')}</p>
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
                      <div key={song.id} className="flex items-center gap-3 p-3 hover:bg-secondary/20 transition-colors">
                        <span className="w-5 text-sm text-center text-muted-foreground font-medium">{idx + 1}</span>
                        {song.albumArtUrl ? (
                          <Image src={song.albumArtUrl} alt={song.title} width={40} height={40} className="h-10 w-10 rounded object-cover shadow-sm" data-ai-hint="song album" />
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
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleMove(idx, -1)} disabled={idx === 0}><ArrowUp /></Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Mover Arriba</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleMove(idx, 1)} disabled={idx === queue.length - 1}><ArrowDown /></Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Mover Abajo</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleRemoveSong(song.id)}><Trash2 /></Button>
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
                            <Image src={song.albumArtUrl} width={32} height={32} className="w-8 h-8 rounded object-cover" alt={song.title} data-ai-hint="song album" />
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
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleAddSong(song)} disabled={queue.some(s => s.spotifyTrackId === song.spotifyTrackId)}>
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
                <Button
                  onClick={handleSpotifyAction}
                  variant={
                    spotifyStatus?.spotifyConnected && spotifyStatus?.tokensOk && spotifyStatus?.playbackAvailable
                      ? 'default'
                      : spotifyStatus?.spotifyConnected && spotifyStatus?.tokensOk
                      ? 'secondary'
                      : 'destructive'
                  }
                  className="w-full"
                >
                  {spotifyStatus?.spotifyConnected ? <><LogOut className="mr-2 h-4 w-4" /> Desconectar Spotify</> : <><ExternalLink className="mr-2 h-4 w-4" /> Conectar Spotify</>}
                </Button>
                {spotifyStatus && (
                  <div className="mt-2 text-xs space-y-0.5 p-2 border rounded-md bg-muted/30">
                    <p>Conectado: {spotifyStatus.spotifyConnected ? 'Sí ✅' : 'No ❌'}</p>
                    <p>Tokens válidos: {spotifyStatus.tokensOk ? 'Sí ✅' : 'No ❌'}</p>
                    <p>Reproducción activa: {spotifyStatus.playbackAvailable ? `Sí en "${spotifyStatus.activeDevice?.name || 'dispositivo desconocido'}" ✅` : 'No ⚠️'}</p>
                    {spotifyStatus.message && <p className="italic text-destructive/80">{spotifyStatus.message}</p>}
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
              <Button variant="outline" onClick={() => auth && signOut(auth)} className="w-full">
                <LogOut className="mr-2 h-4 w-4" /> Cerrar Sesión
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={async () => {
                  if (!db) return;
                  const isConfirmed = window.confirm("¿Estás seguro de que quieres forzar la sincronización? Esto intentará reproducir la siguiente canción de la cola.");
                  if (!isConfirmed) return;

                  toast({ title: "⏳ Forzando sincronización...", description: "Intentando reproducir la siguiente canción." });
                  await handleTrackEndNotification(null); // Simulate track end to trigger next song
                  toast({
                    title: '🎵 Reproducción Forzada',
                    description: 'Se intentó reproducir la siguiente canción.',
                  });
                  mutateCurrentPlaying(); // Refresh current playing info
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Forzar Sincronización
              </Button>
              <Button
                variant="destructive"
                className="w-full"
                onClick={handleClearQueue}
                disabled={queue.length === 0 || isLoadingQueue}
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
