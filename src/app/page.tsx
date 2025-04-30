'use client';

import React, { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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

interface QueueSong extends Song {
  id: string;
  timestampAdded: number | object;
  addedByUserId?: string;
  order?: number;
}

// SWR fetcher para consumir endpoints
const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function ClientPage() {
  const { toast } = useToast();

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
  const [isMounted, setIsMounted] = useState(false);

  // SWR para “currently playing”
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
  });

  // 1. Marcar componente montado
  useEffect(() => {
    setIsMounted(true);
  }, []);

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
    if (!isDbValid) {
      setFirebaseError('Firebase DB mal configurada; funciones indisponibles.');
      setIsLoadingQueue(false);
      setIsLoadingConfig(false);
      return;
    }
    if (!db) {
      setIsLoadingConfig(false);
      return;
    }
    const cfgRef = ref(db, '/config');
    setIsLoadingConfig(true);
    const unsub = onValue(
      cfgRef,
      snap => {
        const data = snap.val() || {};
        setSpotifyConfig({
          searchMode: data.searchMode ?? 'all',
          playlistId: data.playlistId,
          spotifyConnected: true,
        });
        setIsLoadingConfig(false);
      },
      err => {
        console.error('Config read error:', err);
        setFirebaseError('No se pudo cargar configuración de Spotify.');
        toast({
          title: 'Error',
          description: 'Fallo al leer configuración de Spotify.',
          variant: 'destructive',
        });
        setIsLoadingConfig(false);
      }
    );
    return () => unsub();
  }, [toast]);

  // 4. Suscripción a la cola (/queue)
  useEffect(() => {
    if (!db || !isDbValid) {
      setIsLoadingQueue(false);
      return;
    }
    const qRef = ref(db, '/queue');
    setIsLoadingQueue(true);
    const unsub = onValue(
      qRef,
      snap => {
        const data = snap.val() || {};
        const items = Object.entries(data as Record<string, any>)
          .sort(([, a], [, b]) => {
            const oA = a.order ?? a.timestampAdded ?? Infinity;
            const oB = b.order ?? b.timestampAdded ?? Infinity;
            if (typeof oA === 'object') return 1;
            if (typeof oB === 'object') return -1;
            return oA - oB;
          })
          .map(([key, val]) => ({
            id: key,
            ...(val as any),
            timestampAdded: (val as any).timestampAdded ?? 0,
            order: (val as any).order ?? (val as any).timestampAdded,
          }));
        setQueue(items);
        setIsLoadingQueue(false);
        if (userSessionId) {
          setCanAddSong(!items.some(s => s.addedByUserId === userSessionId));
        }
      },
      err => {
        console.error('Queue read error:', err);
        setFirebaseError('No se pudo cargar la cola.');
        toast({
          title: 'Error',
          description: 'Fallo al leer cola de Firebase.',
          variant: 'destructive',
        });
        setIsLoadingQueue(false);
      }
    );
    return () => unsub();
  }, [userSessionId, toast, isDbValid]);

  // 5. Búsqueda con debounce
  const doSearch = useCallback(async () => {
    if (!searchTerm.trim() || isLoadingConfig || !spotifyConfig) {
      setSearchResults([]);
      return;
    }
    setIsLoadingSearch(true);
    try {
      const res = await searchSpotify(searchTerm, spotifyConfig);
      setSearchResults(res);
    } catch (e: any) {
      console.error('Search error:', e);
      toast({
        title: 'Error',
        description: e.message || 'Fallo en búsqueda de Spotify.',
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

  // 6. Añadir canción a la cola
  const handleAddSong = async (song: Song) => {
    if (!db) {
      toast({ title: 'Error', description: 'DB no disponible.', variant: 'destructive' });
      return;
    }
    if (!canAddSong || !userSessionId) {
      toast({
        title: 'No permitido',
        description: userSessionId
          ? 'Ya tienes una canción en la cola.'
          : 'No se identificó tu sesión.',
        variant: 'destructive',
      });
      return;
    }
    if (queue.some(q => q.spotifyTrackId === song.spotifyTrackId)) {
      toast({ title: 'Ya en cola', description: `${song.title} ya existe en la cola.`, variant: 'destructive' });
      return;
    }
    const qRef = ref(db, '/queue');
    const newRef = push(qRef);
    let maxOrder = 0;
    queue.forEach(i => {
      if (typeof i.order === 'number' && i.order > maxOrder) {
        maxOrder = i.order;
      }
    });
    const newData = {
      ...song,
      addedByUserId: userSessionId,
      timestampAdded: serverTimestamp(),
      order: maxOrder + 1000,
    };
    try {
      await set(newRef, newData);
      toast({
        title: 'Añadida',
        description: `${song.title} añadida a la cola.`,
        action: <ToastAction altText="Ok">Ok</ToastAction>,
      });
      setSearchTerm('');
      setSearchResults([]);
    } catch (e) {
      console.error('Write error:', e);
      toast({
        title: 'Error',
        description: 'No se pudo añadir la canción.',
        variant: 'destructive',
      });
    }
  };

  // 7. Quitar propia canción
  const handleRemoveSong = async (id: string) => {
    if (!db) return;
    try {
      await remove(ref(db, `/queue/${id}`));
    } catch (e) {
      console.error('Remove error:', e);
      toast({ title: 'Error', description: 'No se pudo quitar la canción.', variant: 'destructive' });
    }
  };

  // 8. Pantalla de error
  if (firebaseError && !isLoadingQueue && !isLoadingConfig && isMounted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Card className="max-w-lg w-full border border-destructive bg-destructive/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle /> Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-destructive-foreground">{firebaseError}</p>
          </CardContent>
          <CardFooter>
            <Button variant="destructive" onClick={() => window.location.reload()}>
              Recargar
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // 9. Render principal
  return (
    <div className="container mx-auto p-4 min-h-screen bg-background">
      {/* ─── Actualmente sonando ─────────────────────────────────────────── */}
      {currentError && (
        <p className="text-center text-sm text-destructive mb-4">Error al cargar pista actual.</p>
      )}
      {currentPlaying ? (
        currentPlaying.isPlaying && currentPlaying.track ? (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Canción en reproducción</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-4">
              {currentPlaying.track.albumArtUrl ? (
                <Image
                  src={currentPlaying.track.albumArtUrl}
                  alt={currentPlaying.track.name}
                  width={64}
                  height={64}
                  className="rounded"
                />
              ) : (
                <Music className="h-16 w-16 text-muted-foreground" />
              )}
              <div>
                <p className="font-medium">{currentPlaying.track.name}</p>
                <p className="text-sm text-muted-foreground">
                  {currentPlaying.track.artists.join(', ')}
                </p>
                <progress
                  value={currentPlaying.track.progress_ms}
                  max={currentPlaying.track.duration_ms}
                  className="w-full mt-2 h-2 rounded-full overflow-hidden bg-muted"
                />
              </div>
            </CardContent>
            <CardFooter>
              <p className="text-xs text-muted-foreground">
                {Math.floor(currentPlaying.track.progress_ms / 1000)}s /{' '}
                {Math.floor(currentPlaying.track.duration_ms / 1000)}s
              </p>
            </CardFooter>
          </Card>
        ) : (
          <p className="text-center text-sm text-muted-foreground mb-6">
            Spotify está pausado o no hay reproducción.
          </p>
        )
      ) : (
        <p className="text-center text-sm text-muted-foreground mb-6">
          Cargando pista actual…
        </p>
      )}

      {/* ─── Cabecera ───────────────────────────────────────────────────────── */}
      <header className="text-center mb-8">
        <h1 className="text-4xl font-bold flex items-center justify-center gap-2">
          <Music /> Bar Jukebox
        </h1>
        <p className="text-muted-foreground">¡Elige tu música!</p>
      </header>

      {/* ─── Sección de búsqueda ─────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-8 mb-12">
        <div className="lg:col-span-1">
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search /> Buscar
              </CardTitle>
              <CardDescription>
                {isLoadingConfig
                  ? 'Cargando configuración...'
                  : spotifyConfig?.searchMode === 'playlist'
                  ? 'Modo playlist'
                  : 'Explorar todo Spotify'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col flex-1">
              <div className="relative mb-4">
                <Input
                  type="search"
                  placeholder="Nombre de canción o artista..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  disabled={isLoadingConfig || !isDbValid}
                  className="pl-10"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
              <ScrollArea className="flex-1 pr-2">
                {isLoadingSearch ? (
                  [...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded" />
                  ))
                ) : (
                  <ul className="space-y-2">
                    {searchResults.map(song => {
                      const inQ = queue.some(q => q.spotifyTrackId === song.spotifyTrackId);
                      return (
                        <li
                          key={song.spotifyTrackId}
                          className="flex items-center justify-between p-2 rounded hover:bg-secondary cursor-pointer"
                          onClick={() => !inQ && handleAddSong(song)}
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            {song.albumArtUrl ? (
                              <Image
                                src={song.albumArtUrl}
                                alt={song.title}
                                width={40}
                                height={40}
                                className="rounded object-cover"
                              />
                            ) : (
                              <div className="h-10 w-10 bg-muted rounded flex items-center justify-center">
                                <Music className="text-muted-foreground" />
                              </div>
                            )}
                            <div className="truncate">
                              <p className="truncate">{song.title}</p>
                              <p className="text-sm text-muted-foreground truncate">
                                {song.artist}
                              </p>
                            </div>
                          </div>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={e => {
                                    e.stopPropagation();
                                    handleAddSong(song);
                                  }}
                                  disabled={inQ}
                                  aria-label={inQ ? 'Ya en cola' : 'Añadir a cola'}
                                >
                                  {inQ ? (
                                    <CheckCircle className="text-green-500" />
                                  ) : (
                                    <PlusCircle />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{inQ ? 'Ya en cola' : 'Añadir a la cola'}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* ─── Sección Cola ───────────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListMusic /> Cola Musical
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full p-4 space-y-3">
                {isLoadingQueue ? (
                  [...Array(3)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-2">
                      <Skeleton className="h-10 w-10 rounded" />
                      <Skeleton className="h-4 w-1/2 rounded" />
                    </div>
                  ))
                ) : queue.length > 0 ? (
                  queue.map((song, idx) => (
                    <div
                      key={song.id}
                      className="flex items-center gap-3 p-3 rounded hover:bg-secondary cursor-default"
                    >
                      <span className="w-6 text-center">{idx + 1}</span>
                      {song.albumArtUrl ? (
                        <Image
                          src={song.albumArtUrl}
                          alt={song.title}
                          width={48}
                          height={48}
                          className="rounded object-cover"
                        />
                      ) : (
                        <div className="h-12 w-12 bg-muted rounded flex items-center justify-center">
                          <Music className="text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 truncate">
                        <p className="truncate">{song.title}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {song.artist}
                        </p>
                      </div>
                      {song.addedByUserId === userSessionId && (
                        <div className="flex items-center gap-2">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <CheckCircle className="text-green-500" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Añadida por ti</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <button
                            type="button"
                            title="Quitar canción"
                            aria-label="Quitar canción"
                            onClick={() => handleRemoveSong(song.id)}
                            className="text-red-500 cursor-pointer"
                          >
                            <XCircle />
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-center py-8 text-muted-foreground">
                    La cola está vacía.
                  </p>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      <footer className="text-center mt-8 text-sm text-muted-foreground">
        Hecho con ❤️ para tu bar.
      </footer>
    </div>
  );
}
