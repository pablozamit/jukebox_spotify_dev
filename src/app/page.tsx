'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import useSWR from 'swr';
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
} from 'lucide-react';
import { searchSpotify } from '@/services/spotify';
import {
  ref,
  onValue,
  push,
  set,
  remove,
  serverTimestamp,
} from 'firebase/database';
import { db, isDbValid } from '@/lib/firebase';
import { ToastAction } from '@/components/ui/toast';
import Image from 'next/image';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

// Definir interfaces con tipado estricto
interface QueueSong extends Song {
  id: string;
  timestampAdded: number;
  addedByUserId?: string;
  order?: number;
}

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
const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const error: FetchError = new Error('An error occurred while fetching the data.');
    error.info = await res.json();
    error.status = res.status;
    throw error;
  }
  return res.json();
};

export default function ClientPage() {
  const { toast } = useToast();
  const syncLock = useRef(false);

  // Estado general
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [queue, setQueue] = useState<QueueSong[]>([]);
  const [isLoadingSearch, setIsLoadingSearch] = useState(false);
  const [isLoadingQueue, setIsLoadingQueue] = useState(true);
  const [canAddSong, setCanAddSong] = useState(true);
  const [userSessionId, setUserSessionId] = useState<string | null>(null);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);
  const [spotifyConfig, setSpotifyConfig] = useState<SpotifyConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [playlistDetails, setPlaylistDetails] = useState<PlaylistDetails | null>(null);
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // SWR para "currently playing"
  const { data: currentPlaying, error: currentError } = useSWR<{
    isPlaying: boolean;
    track?: {
      id: string;
      name: string;
      artists: string[];
      albumArtUrl: string | null;
      progress_ms: number;
      duration_ms: number;
    };
  }>('/api/spotify/current', fetcher, {
    refreshInterval: 3000,
    onError: (err) => {
      console.error('SWR current playing error:', err);
      toast({
        title: 'Error al Cargar Pista Actual',
        description: 'No se pudo obtener la canción actual desde Spotify.',
        variant: 'destructive',
      });
    },
  });

  // 1. Marcar componente montado
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // 1.1 Sincronización periódica cada 3 segundos
  useEffect(() => {
    let isSyncing = false;

    const interval = setInterval(async () => {
      if (isSyncing) return;
      isSyncing = true;

      try {
        await fetch('/api/spotify/sync', { method: 'POST' });
      } catch (e) {
        console.error('Error syncing:', e);
      } finally {
        isSyncing = false;
      }
    }, 3000); // cada 3 segundos

    return () => clearInterval(interval);
  }, []);

  // Efecto para sincronizar la siguiente canción cuando queda poco tiempo
  useEffect(() => {
    if (!currentPlaying?.isPlaying || !currentPlaying.track) return;

    const remaining = currentPlaying.track.duration_ms - currentPlaying.track.progress_ms;

    if (remaining < 4000 && !syncLock.current) {
      syncLock.current = true;

      fetch('/api/spotify/sync', { method: 'POST' }).finally(() => {
        // Esperamos 10s antes de permitir otra sincronización
        setTimeout(() => {
          syncLock.current = false;
        }, 10000);
      });
    }
  }, [currentPlaying]);

  // 12. Reproducir siguiente canción automáticamente si no hay nada sonando
  useEffect(() => {
    if (!isMounted || !currentPlaying) return;

    if (!currentPlaying.isPlaying) {
      // Esperar unos segundos para evitar llamadas duplicadas por errores temporales
      const timeout = setTimeout(() => {
        fetch('/api/spotify/sync', { method: 'POST' }).catch((err) =>
          console.error('Error al llamar a /api/spotify/sync:', err)
        );
      }, 3000); // espera de 3 segundos

      return () => clearTimeout(timeout);
    }
  }, [currentPlaying, isMounted]);

  // 2. Generar o recuperar sesión sencilla
  useEffect(() => {
    let sid = sessionStorage.getItem('jukeboxUserSessionId');
    if (!sid) {
      sid = `user_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('jukeboxUserSessionId', sid);
    }
    setUserSessionId(sid);
  }, []);

  // 3. Cargar configuración de Firebase (/config)
  useEffect(() => {
    if (!isDbValid || !db) {
      setFirebaseError(
        'La base de datos de Firebase no está configurada correctamente (verifica DATABASE_URL en .env). Las funciones del Jukebox no estarán disponibles.'
      );
      setIsLoadingQueue(false);
      setIsLoadingConfig(false);
      return;
    }

    const cfgRef = ref(db, '/config');
    setIsLoadingConfig(true);
    const unsub = onValue(
      cfgRef,
      (snap) => {
        const data = snap.val() || {};
        setSpotifyConfig({
          searchMode: data.searchMode ?? 'all',
          playlistId: data.playlistId,
          spotifyConnected: !!data,
        });
        setIsLoadingConfig(false);
      },
      (err) => {
        console.error('Error leyendo configuración de Firebase:', err);
        setFirebaseError('No se pudo cargar la configuración desde Firebase.');
        toast({
          title: 'Error de Configuración',
          description: 'Fallo al leer la configuración de Firebase.',
          variant: 'destructive',
        });
        setIsLoadingConfig(false);
      }
    );
    return () => unsub();
  }, [isDbValid, toast]);

  // 4. Fetch Playlist Details when config is loaded and in playlist mode
  useEffect(() => {
    if (!isMounted || !spotifyConfig || spotifyConfig.searchMode !== 'playlist' || !spotifyConfig.playlistId) {
      setPlaylistDetails(null);
      setIsLoadingPlaylist(false);
      return;
    }

    const fetchDetails = async () => {
      setIsLoadingPlaylist(true);
      try {
        const res = await fetch(`/api/spotify/playlist-details?playlistId=${spotifyConfig.playlistId}`);
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
  }, [spotifyConfig, isMounted, toast]);

  // 5. Suscripción a la cola (/queue)
  useEffect(() => {
    if (!db || !isDbValid) {
      setIsLoadingQueue(false);
      return;
    }

    const qRef = ref(db, '/queue');
    setIsLoadingQueue(true);
    const unsub = onValue(
      qRef,
      (snap) => {
        const data = snap.val() || {};
        const items = Object.entries(data as Record<string, Omit<QueueSong, 'id'>>)
          .map(([key, val]) => ({
            id: key,
            ...val,
            timestampAdded: typeof val.timestampAdded === 'number' ? val.timestampAdded : 0,
            order: typeof val.order === 'number' ? val.order : val.timestampAdded ?? 0,
          }))
          .sort((a, b) => a.order - b.order);
        setQueue(items);
        setIsLoadingQueue(false);
        if (userSessionId) {
          setCanAddSong(!items.some((s) => s.addedByUserId === userSessionId));
        }
      },
      (err) => {
        console.error('Error leyendo la cola de Firebase:', err);
        setFirebaseError('No se pudo cargar la cola de canciones.');
        toast({
          title: 'Error de Cola',
          description: 'Fallo al leer la cola desde Firebase.',
          variant: 'destructive',
        });
        setIsLoadingQueue(false);
      }
    );
    return () => unsub();
  }, [userSessionId, isDbValid, toast]);

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
      setSearchResults(res);
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

  useEffect(() => {
    if (!isMounted || isLoadingConfig) return;
    const id = setTimeout(doSearch, 500);
    return () => clearTimeout(id);
  }, [searchTerm, doSearch, isMounted, isLoadingConfig]);

  // 7. Añadir canción a la cola
  const handleAddSong = async (song: Song) => {
    if (!db || !isDbValid) {
      toast({ title: 'Error', description: 'Base de datos no disponible.', variant: 'destructive' });
      return;
    }

    if (!canAddSong || !userSessionId) {
      toast({
        title: 'Acción no permitida',
        description: userSessionId
          ? 'Ya tienes una canción en la cola. Puedes quitarla para añadir otra.'
          : 'No se pudo identificar tu sesión.',
        variant: 'destructive',
      });
      return;
    }

    if (queue.some((q) => q.spotifyTrackId === song.spotifyTrackId)) {
      toast({
        title: 'Canción Repetida',
        description: `${song.title} ya está en la cola.`,
        variant: 'destructive',
      });
      return;
    }

    const qRef = ref(db, '/queue');
    const newRef = push(qRef);
    const maxOrder = Math.max(...queue.map((i) => (typeof i.order === 'number' ? i.order : 0)), 0);

    const newData: Omit<QueueSong, 'id'> = {
      spotifyTrackId: song.spotifyTrackId,
      title: song.title,
      artist: song.artist,
      albumArtUrl: song.albumArtUrl,
      addedByUserId: userSessionId,
      timestampAdded: 0,
      order: maxOrder + 1000,
    };

    try {
      await set(newRef, { ...newData, timestampAdded: serverTimestamp() });
      setSearchTerm('');
      setSearchResults([]);
      toast({
        title: 'Canción Añadida',
        description: `${song.title} ha sido añadida a la cola.`,
      });
    } catch (e) {
      console.error('Error al escribir en Firebase:', e);
      toast({
        title: 'Error al Añadir',
        description: 'No se pudo añadir la canción a la cola.',
        variant: 'destructive',
      });
    }
  };

  // 8. Quitar propia canción
  const handleRemoveSong = async (id: string) => {
    if (!db || !isDbValid) return;
    try {
      await remove(ref(db, `/queue/${id}`));
      toast({
        title: 'Canción Eliminada',
        description: 'Tu canción ha sido eliminada de la cola.',
      });
      setCanAddSong(true); // Allow proposing/voting again after removing
    } catch (e) {
      console.error('Error al eliminar de Firebase:', e);
      toast({
        title: 'Error al Eliminar',
        description: 'No se pudo quitar la canción.',
        variant: 'destructive',
      });
    }
  };

  // 9. Memoizar componentes para optimizar renderizado
  const SearchResultItem = useMemo(() => {
    return ({ song }: { song: Song }) => {
      const inQueue = queue.some((q) => q.spotifyTrackId === song.spotifyTrackId);
      const addedByThisUser = queue.some(
        (q) => q.spotifyTrackId === song.spotifyTrackId && q.addedByUserId === userSessionId
      );
      // Nueva variable para verificar si el usuario ya propuso alguna canción (Mejora 1)
      const hasUserProposed = queue.some((q) => q.addedByUserId === userSessionId);
      // Ajuste en la lógica de canCurrentUserAdd (Mejora 1)
      const canCurrentUserAdd = !hasUserProposed && !inQueue;

      return (
        <div
          key={song.spotifyTrackId}
          className={`flex items-center justify-between p-2 rounded-md transition-colors ${
            canCurrentUserAdd ? 'hover:bg-secondary/50 cursor-pointer' : 'opacity-70 cursor-not-allowed'
          }`}
          onClick={() => canCurrentUserAdd && handleAddSong(song)}
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
                    if (canCurrentUserAdd) {
                      e.stopPropagation();
                      handleAddSong(song);
                    } else if (addedByThisUser) {
                      e.stopPropagation();
                      handleRemoveSong(queue.find((q) => q.spotifyTrackId === song.spotifyTrackId)!.id);
                    } else {
                      e.stopPropagation();
                    }
                  }}
                  // Ajuste en disabled para desactivar visualmente (Mejora 3)
                  disabled={hasUserProposed && !addedByThisUser}
                  aria-label={
                    addedByThisUser
                      ? 'Quitar de la cola'
                      : inQueue
                      ? 'Ya en cola'
                      : hasUserProposed
                      ? 'Ya propusiste una canción'
                      : 'Añadir a la cola'
                  }
                  className={`h-8 w-8 rounded-full ${
                    addedByThisUser
                      ? 'text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50'
                      : inQueue
                      ? 'text-green-500'
                      : ''
                  }`}
                >
                  {addedByThisUser ? (
                    <XCircle />
                  ) : inQueue ? (
                    <CheckCircle />
                  ) : (
                    <PlusCircle />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {addedByThisUser
                    ? 'Quitar de la cola'
                    : inQueue
                    ? 'Ya está en la cola'
                    : hasUserProposed
                    ? 'Ya propusiste una canción'
                    : 'Añadir a la cola'}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      );
    };
  }, [queue, canAddSong, userSessionId, handleAddSong, handleRemoveSong]);

  // 10. Pantalla de error de Firebase
  if (firebaseError && !isLoadingQueue && !isLoadingConfig && isMounted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Card className="max-w-lg w-full border border-destructive bg-destructive/10 shadow-xl rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle /> Error de Conexión
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-destructive-foreground">{firebaseError}</p>
            <p className="text-sm text-destructive-foreground/80 mt-2">
              Por favor, verifica la configuración de Firebase en las variables de entorno (.env) y asegúrate de que la base de datos esté accesible.
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
        <h1 className="text-4xl md:text-5xl font-bold text-primary flex items-center justify-center gap-3">
          <Music className="h-8 w-8 md:h-10 md:w-10" /> Bar Jukebox
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
                    isLoadingConfig ||
                    !isDbValid ||
                    (spotifyConfig?.searchMode === 'playlist' && !playlistDetails && !isLoadingPlaylist)
                  }
                  className="pl-10 pr-4 py-2 border-border focus:border-primary focus:ring-primary rounded-md"
                />
              </div>
              {/* Mensaje de ayuda dinámico (Mejora 2) */}
              <p className="text-xs text-muted-foreground mt-2 italic">
                Puedes añadir una canción o votar una ya añadida... pero no ambas.
              </p>
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
                        key={song.id}
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
                        {song.addedByUserId === userSessionId && (
                          <div className="flex items-center gap-2">
                            <TooltipProvider delayDuration={100}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full"
                                    onClick={() => handleRemoveSong(song.id)}
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
    </div>
  );
}