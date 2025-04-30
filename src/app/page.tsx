
'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
import { Music, Search, ListMusic, PlusCircle, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { searchSpotify } from '@/services/spotify';
import {
  ref,
  onValue,
  push,
  set,
  serverTimestamp
} from 'firebase/database';
import { db, isDbValid } from '@/lib/firebase';
import { ToastAction } from '@/components/ui/toast';
import Image from 'next/image'; // Import next/image

interface QueueSong extends Song {
  id: string; // Firebase key
  timestampAdded: number | object;
  addedByUserId?: string;
  order?: number;
}

export default function ClientPage() {
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
  const { toast } = useToast();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Set user session ID
  useEffect(() => {
    let sessionId = sessionStorage.getItem('jukeboxUserSessionId');
    if (!sessionId) {
      sessionId = `user_${Math.random().toString(36).substring(2, 9)}`;
      sessionStorage.setItem('jukeboxUserSessionId', sessionId);
    }
    setUserSessionId(sessionId);
  }, []);

  // Check Firebase validity and load config
  useEffect(() => {
    if (!isDbValid) {
      setFirebaseError(
        'La base de datos de Firebase no está configurada correctamente (revisa DATABASE_URL en .env). Las funciones del Jukebox no están disponibles.'
      );
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
    const unsubscribeConfig = onValue(
      cfgRef,
      snapshot => {
        const data = snapshot.val() || {};
        setSpotifyConfig({
          searchMode: data.searchMode ?? 'all',
          playlistId: data.playlistId,
          spotifyConnected: true, // Assume connected if we can read config
        });
        setIsLoadingConfig(false);
      },
      error => {
        console.error('Error al leer la configuración de Firebase:', error);
        setFirebaseError('No se pudo cargar la configuración de Spotify.');
        toast({
          title: 'Error',
          description: 'No se pudo cargar la configuración de Spotify.',
          variant: 'destructive',
        });
        setSpotifyConfig(null);
        setIsLoadingConfig(false);
      }
    );
    return () => unsubscribeConfig();
  }, [toast]); // Dependency only on toast

  // Subscribe to queue changes
  useEffect(() => {
    if (!db || !isDbValid) {
      setIsLoadingQueue(false);
      return;
    }

    const queueRef = ref(db, '/queue');
    setIsLoadingQueue(true);
    const unsubscribeQueue = onValue(
      queueRef,
      snapshot => {
        const data = snapshot.val() || {};
        const items = Object.entries(data)
          .sort(([, a], [, b]) => {
            const orderA = (a as any).order ?? (typeof (a as any).timestampAdded === 'number' ? (a as any).timestampAdded : Infinity);
            const orderB = (b as any).order ?? (typeof (b as any).timestampAdded === 'number' ? (b as any).timestampAdded : Infinity);
             if (typeof orderA === 'object' && typeof orderB === 'object') return 0;
             if (typeof orderA === 'object') return 1;
             if (typeof orderB === 'object') return -1;
             return orderA - orderB;
          })
          .map(([key, val]) => ({
            id: key,
            ...(val as any),
             timestampAdded: (val as any).timestampAdded ?? 0,
             order: (val as any).order ?? (val as any).timestampAdded,
          }));
        setQueue(items);
        setIsLoadingQueue(false);
        // Update canAddSong state based on the current queue and user session
        if (userSessionId) {
          const userHasSongInQueue = items.some(song => song.addedByUserId === userSessionId);
          setCanAddSong(!userHasSongInQueue);
        }
      },
      error => {
        console.error('Error al leer la cola de Firebase:', error);
        setFirebaseError('No se pudo cargar la cola de canciones.');
        toast({
          title: 'Error',
          description: 'No se pudo cargar la cola de canciones.',
          variant: 'destructive',
        });
        setIsLoadingQueue(false);
      }
    );
    return () => unsubscribeQueue();
  }, [userSessionId, toast, isDbValid]); // Re-run if userSessionId or db validity changes

  // Debounced search handler
  const handleSearch = useCallback(async () => {
    if (!searchTerm.trim() || isLoadingConfig || !spotifyConfig) {
      setSearchResults([]);
      return;
    }
    setIsLoadingSearch(true);
    try {
      const results = await searchSpotify(searchTerm, spotifyConfig);
      setSearchResults(results);
    } catch (e: any) {
      console.error('Error en búsqueda de Spotify:', e);
      toast({
        title: 'Error de Búsqueda',
        description: e.message || 'No se pudieron obtener canciones de Spotify.',
        variant: 'destructive',
      });
      setSearchResults([]);
    } finally {
      setIsLoadingSearch(false);
    }
  }, [searchTerm, spotifyConfig, isLoadingConfig, toast]);

  // Trigger search on searchTerm change (debounced)
  useEffect(() => {
    // Only run search if component is mounted and Firebase/Spotify config is ready
    if (!isMounted || isLoadingConfig) return;
    const timeoutId = setTimeout(() => {
      handleSearch();
    }, 500); // 500ms debounce
    return () => clearTimeout(timeoutId);
  }, [searchTerm, handleSearch, isMounted, isLoadingConfig]);

  // Add song handler
  const handleAddSong = async (song: Song) => {
    if (!db) {
      toast({ title: 'Error', description: 'La conexión a la base de datos no está disponible.', variant: 'destructive' });
      return;
    }
    if (!canAddSong || !userSessionId) {
      toast({
        title: 'No se Puede Añadir la Canción',
        description: userSessionId ? 'Ya tienes una canción en la cola.' : 'No se puede identificar la sesión de usuario.',
        variant: 'destructive',
      });
      return;
    }
    const alreadyInQueue = queue.some(q => q.spotifyTrackId === song.spotifyTrackId);
    if (alreadyInQueue) {
      toast({ title: 'Ya en la Cola', description: `${song.title} ya está en la cola.`, variant: 'destructive' });
      return;
    }

    const queueRef = ref(db, '/queue');
    const newRef = push(queueRef);

     let maxOrder = 0;
     queue.forEach(item => {
       if (typeof item.order === 'number' && item.order > maxOrder) {
         maxOrder = item.order;
       }
     });
    const nextOrder = maxOrder + 1000;

    const newData = {
      ...song,
      addedByUserId: userSessionId,
      timestampAdded: serverTimestamp(),
      order: nextOrder,
    };

    try {
      await set(newRef, newData);
      toast({
        title: '¡Canción Añadida!',
        description: `${song.title} de ${song.artist} añadida a la cola.`,
        action: <ToastAction altText="Vale">Vale</ToastAction>,
      });
      setSearchTerm(''); // Clear search after adding
      setSearchResults([]);
    } catch (e) {
      console.error('Error al escribir en Firebase:', e);
      toast({ title: 'Error al Añadir Canción', description: 'No se pudo añadir la canción a la cola.', variant: 'destructive' });
    }
  };

  // Render Error State
  if (firebaseError && !isLoadingQueue && !isLoadingConfig && isMounted) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-background to-secondary/10 p-4">
        <Card className="w-full max-w-lg shadow-xl border border-destructive bg-destructive/5 rounded-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-semibold text-destructive flex items-center justify-center gap-2">
              <AlertTriangle className="h-6 w-6" /> Ocurrió un Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-center text-destructive-foreground px-4">
              {firebaseError}
            </p>
            <p className="text-center text-sm text-muted-foreground mt-2">
              Por favor, asegúrate de que Firebase esté configurado correctamente en tus variables de entorno (.env), especialmente `DATABASE_URL`.
            </p>
          </CardContent>
          <CardFooter className="flex justify-center">
             <Button variant="destructive" onClick={() => window.location.reload()}>
               <RefreshCw className="mr-2 h-4 w-4" />
               Recargar Página
             </Button>
           </CardFooter>
        </Card>
      </div>
    );
  }

  // Render Main Application UI
  return (
    <div className="container mx-auto px-4 py-8 min-h-screen bg-gradient-to-br from-background via-background to-secondary/10 font-sans">
      <header className="text-center mb-12 pt-8">
          <div className="flex items-center justify-center gap-4 mb-4">
            {/* Placeholder for a cool logo or icon */}
            <div className="p-3 bg-primary rounded-full shadow-lg">
                <Music className="h-8 w-8 text-primary-foreground"/>
            </div>
            <h1 className="text-5xl font-extrabold text-primary tracking-tight">
                Bar Jukebox
            </h1>
          </div>
          <p className="text-xl text-muted-foreground font-light">
            ¡Elige la banda sonora de la noche! Busca tus canciones favoritas y añádelas a la cola.
          </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Search Section */}
        <div className="lg:col-span-1">
          <Card className="shadow-xl rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm transition-all hover:shadow-2xl h-full flex flex-col">
            <CardHeader className="pb-4">
              <CardTitle className="text-2xl font-bold flex items-center gap-3 text-primary">
                <Search className="h-6 w-6" /> Buscar Canción
              </CardTitle>
              <CardDescription className="text-base">
                 {isLoadingConfig
                  ? 'Cargando configuración...'
                  : spotifyConfig?.searchMode === 'playlist'
                  ? 'Busca dentro de nuestra playlist seleccionada.'
                  : 'Explora todo el catálogo de Spotify.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 flex-grow flex flex-col pt-0">
               <div className="relative">
                 <Input
                    type="search"
                    placeholder={
                      isLoadingConfig
                      ? 'Cargando...'
                      : spotifyConfig?.searchMode === 'playlist'
                      ? 'Buscar en playlist...'
                      : 'Nombre de canción o artista...'
                    }
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    disabled={isLoadingConfig || !isDbValid || !spotifyConfig?.spotifyConnected}
                    className="pl-10 text-lg h-12 rounded-lg border-2 focus:border-primary focus:ring-primary/50 transition-shadow duration-200 shadow-inner"
                  />
                 <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
               </div>
              <Separator className="my-4"/>
              <ScrollArea className="flex-grow h-[300px] md:h-[450px] pr-3 -mr-3 rounded-md">
                {isLoadingSearch ? (
                  <div className="space-y-3 p-1">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="flex items-center space-x-3 p-2">
                         <Skeleton className="h-12 w-12 rounded-lg flex-shrink-0 bg-muted/50" />
                         <div className="space-y-2 flex-1">
                            <Skeleton className="h-5 w-3/4 rounded bg-muted/50" />
                            <Skeleton className="h-4 w-1/2 rounded bg-muted/50" />
                         </div>
                         <Skeleton className="h-8 w-8 rounded-full bg-muted/50"/>
                      </div>
                     ))}
                  </div>
                ) : searchResults.length > 0 ? (
                  <ul className="space-y-2">
                    {searchResults.map((song) => {
                      const inQueue = queue.some(q => q.spotifyTrackId === song.spotifyTrackId);
                      const addedByUser = queue.some(q => q.spotifyTrackId === song.spotifyTrackId && q.addedByUserId === userSessionId);
                      const disableAdd = !canAddSong || !isDbValid || inQueue;

                      return (
                        <li
                          key={song.spotifyTrackId}
                          className="flex items-center justify-between p-3 rounded-lg hover:bg-secondary/60 transition-all duration-150 ease-in-out cursor-pointer group"
                          onClick={() => !disableAdd && handleAddSong(song)}
                          role="button"
                          aria-disabled={disableAdd}
                        >
                          <div className="flex items-center gap-4 overflow-hidden flex-1 mr-2">
                            {song.albumArtUrl ? (
                              <Image // Use next/image
                                src={song.albumArtUrl}
                                alt={`Portada de ${song.title}`}
                                width={48} // Specify width
                                height={48} // Specify height
                                className="rounded-md object-cover flex-shrink-0 shadow-md transition-transform duration-200 group-hover:scale-105"
                                loading="lazy"
                              />
                             ) : (
                                <div className="h-12 w-12 rounded-md bg-muted flex items-center justify-center flex-shrink-0 shadow-sm">
                                  <Music className="h-6 w-6 text-muted-foreground" />
                                </div>
                              )}
                            <div className="overflow-hidden">
                              <p className="font-semibold truncate text-base" title={song.title}>
                                {song.title}
                              </p>
                              <p className="text-sm text-muted-foreground truncate" title={song.artist}>
                                {song.artist}
                              </p>
                            </div>
                          </div>
                           <TooltipProvider>
                                <Tooltip delayDuration={100}>
                                  <TooltipTrigger asChild>
                                      <Button
                                        variant={inQueue ? "ghost" : "ghost"} // Consistent variant
                                        size="icon"
                                        onClick={(e) => { e.stopPropagation(); handleAddSong(song); }} // Prevent li click, handle add
                                        disabled={disableAdd}
                                        aria-label={inQueue ? `${song.title} ya está en cola` : `Añadir ${song.title} a la cola`}
                                        className={`flex-shrink-0 transition-all duration-200 rounded-full h-9 w-9 ${disableAdd && !inQueue ? 'opacity-50 cursor-not-allowed bg-muted/30 hover:bg-muted/40' : ''} ${inQueue ? 'text-green-500 bg-green-500/10 hover:bg-green-500/20' : 'text-primary hover:bg-primary/10 hover:text-primary'}`}
                                      >
                                        {inQueue ? <CheckCircle className="h-5 w-5" /> : <PlusCircle className="h-5 w-5" />}
                                      </Button>
                                  </TooltipTrigger>
                                  <TooltipContent className="bg-background border border-border shadow-lg rounded-md">
                                    <p>{inQueue ? 'Ya en la cola' : (disableAdd ? 'Ya tienes una canción en cola' : 'Añadir a la cola')}</p>
                                  </TooltipContent>
                                </Tooltip>
                           </TooltipProvider>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="text-center py-10 px-4 flex flex-col items-center justify-center h-full">
                     <Search className="h-16 w-16 text-muted-foreground/50 mb-4"/>
                     <p className="text-muted-foreground text-lg">
                       {isLoadingConfig
                        ? 'Conectando con Spotify...'
                        : !spotifyConfig?.spotifyConnected
                        ? 'La conexión con Spotify no está disponible.'
                        : searchTerm
                        ? 'No encontramos esa canción...'
                        : spotifyConfig?.searchMode === 'playlist'
                        ? 'Escribe para buscar en la playlist.'
                        : 'Empieza a buscar tu música.'}
                     </p>
                   </div>
                )}
              </ScrollArea>
              {!canAddSong && isMounted && (
                <p className="text-xs text-center text-destructive/90 mt-2 px-2 font-medium">
                   ¡Ups! Solo puedes añadir una canción a la vez. Espera a que suene la tuya.
                </p>
              )}
            </CardContent>
             <CardFooter className="p-4 border-t border-border/50 mt-auto">
                <p className="text-xs text-muted-foreground text-center w-full italic">
                  {spotifyConfig?.searchMode === 'playlist' ? 'Modo Playlist Activado' : 'Buscando en Todo Spotify'}
                </p>
              </CardFooter>
          </Card>
        </div>

        {/* Queue Section */}
        <div className="lg:col-span-2">
          <Card className="shadow-xl rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm transition-all hover:shadow-2xl h-full flex flex-col">
            <CardHeader className="pb-4">
              <CardTitle className="text-2xl font-bold flex items-center gap-3 text-primary">
                <ListMusic className="h-6 w-6" /> La Cola Musical
              </CardTitle>
              <CardDescription className="text-base">Estas son las próximas canciones en sonar.</CardDescription>
            </CardHeader>
            <CardContent className="flex-grow overflow-hidden p-0">
              <ScrollArea className="h-[550px] md:h-[600px] p-4 md:p-6">
                {isLoadingQueue ? (
                   <div className="space-y-4 p-1">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="flex items-center space-x-4 p-3">
                        <Skeleton className="h-14 w-14 rounded-lg flex-shrink-0 bg-muted/50" />
                        <div className="space-y-2 flex-1">
                          <Skeleton className="h-5 w-3/4 rounded bg-muted/50" />
                          <Skeleton className="h-4 w-1/2 rounded bg-muted/50" />
                        </div>
                        <Skeleton className="h-6 w-6 rounded-full bg-muted/50" />
                      </div>
                    ))}
                  </div>
                ) : queue.length > 0 ? (
                  <ul className="space-y-3">
                    {queue.map((song, idx) => (
                      <li
                        key={song.id}
                        className={`flex items-center gap-4 p-4 rounded-xl transition-all duration-200 ease-in-out shadow-sm ${idx === 0 ? 'bg-primary/10 border-2 border-primary/30 scale-[1.02] shadow-lg' : 'bg-card/50 hover:bg-secondary/40 border border-border/30'}`}
                      >
                        <span className={`w-8 text-center text-xl font-bold ${idx === 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                          {idx + 1}.
                        </span>
                        {song.albumArtUrl ? (
                          <Image // Use next/image
                            src={song.albumArtUrl}
                            alt={`Portada de ${song.title}`}
                            width={64} // Larger image in queue
                            height={64}
                            className="rounded-lg object-cover shadow-md flex-shrink-0"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 shadow-sm">
                            <Music className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-grow overflow-hidden">
                          <p className={`font-semibold text-lg truncate ${idx === 0 ? 'text-primary' : ''}`} title={song.title}>
                            {song.title}
                          </p>
                          <p className="text-base text-muted-foreground truncate" title={song.artist}>
                            {song.artist}
                          </p>
                        </div>
                        {song.addedByUserId === userSessionId && (
                         <TooltipProvider>
                            <Tooltip delayDuration={100}>
                              <TooltipTrigger>
                                <CheckCircle className="h-6 w-6 text-green-500 flex-shrink-0 animate-pulse" />
                              </TooltipTrigger>
                              <TooltipContent className="bg-background border border-border shadow-lg rounded-md">
                                <p>¡Añadida por ti!</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-center py-16 px-4 flex flex-col items-center justify-center h-full">
                     <ListMusic className="h-20 w-20 text-muted-foreground/40 mb-6"/>
                     <p className="text-muted-foreground text-xl mb-2">
                       La cola está vacía... por ahora.
                     </p>
                     <p className="text-muted-foreground/80 text-base">
                       {isMounted && !isDbValid ? 'La cola no está disponible debido a un error de base de datos.' : '¡Anímate y busca tu canción favorita para empezar la fiesta!'}
                     </p>
                   </div>
                )}
              </ScrollArea>
            </CardContent>
            {isMounted && !isDbValid && (
              <CardFooter className="border-t border-border/50 px-6 py-4 bg-destructive/10 rounded-b-xl">
                <p className="text-sm text-destructive flex items-center gap-2 w-full font-medium">
                  <AlertTriangle className="h-5 w-5" />
                  Error: La cola no está disponible. Revisa la configuración de la base de datos.
                </p>
              </CardFooter>
            )}
          </Card>
        </div>
      </div>

      <footer className="text-center mt-16 pb-8 text-muted-foreground text-sm">
        Hecho con ❤️ y 🎵 para tu bar.
      </footer>
    </div>
  );
}


// TooltipProvider and Tooltip components (you might need to import these if not globally available)
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
