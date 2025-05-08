'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { ref, onValue, remove, update, push, set, serverTimestamp } from 'firebase/database';
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
  Search, Home, LogOut, AlertTriangle, RefreshCw, PlusCircle
} from 'lucide-react';
import Image from 'next/image';


interface QueueSong {
  id: string;
  spotifyTrackId: string;
  title: string;
  artist: string;
  albumArtUrl?: string;
  order?: number;
  addedByUserId?: string;
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
  const [spotifyStatus, setSpotifyStatus] = useState<null | {
    spotifyConnected: boolean;
    tokensOk: boolean;
    playbackAvailable: boolean;
    message?: string;
  }>(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [isLoadingSearch, setIsLoadingSearch] = useState(false);

  // 🔊 SWR para canción actual
  const { data: currentPlaying } = useSWR('/api/spotify/current', fetcher, { refreshInterval: 3000 });

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
            .sort(([, a], [, b]) => ((a as any).order ?? 0) - ((b as any).order ?? 0))
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
                return { id: key, ...(val as any) };
              })
              .filter((item): item is QueueSong => item !== null);
              
              
          
          if(items.length) setQueue(items as QueueSong[]);
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
          setConfig({ searchMode: data.searchMode, playlistId: data.playlistId });
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

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/spotify/status');
        const json = await res.json();
        setSpotifyStatus(json);
      } catch (e) {
        console.error('Error al consultar estado de Spotify:', e);
        setSpotifyStatus(null);
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 10000); // cada 10s
    return () => clearInterval(interval);
  }, []);
  

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/spotify/sync', { method: 'POST' });
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(errorText || 'Error al sincronizar');
        }
        const json = await res.json();        
        if (json.action === 'started') {
          toast({
            title: '🎵 Reproducción iniciada',
            description: `Ahora suena: ${json.track?.title}`,
          });
        }
      } catch (e: any) {
        console.error('Error en sincronización automática:', e.message);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [toast]);

 const handleRemoveSong = async (songId: string) => {
    console.log(songId);
    if (!db) return;
    try{
      await remove(ref(db, `/queue/${songId}`));
      toast({ title: 'Canción eliminada', description: 'La canción ha sido eliminada de la cola.' });
    }catch(e: any){
      console.error('Error eliminando canción:', e);
      toast({ title: 'Error', description: 'No se pudo eliminar la canción.', variant: 'destructive' });
    }
  };

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
      setQueue(newQueue);
    } catch (error) {
      console.error("Error updating queue order:", error);
      toast({ title: 'Error', description: 'Error al actualizar el orden de la cola.' });
    }
  };

  const handleSpotifyAction = async () => {
    if (spotifyStatus?.spotifyConnected) {
        await fetch('/api/spotify/disconnect', { method: 'POST' });
        setSpotifyStatus(null);
      } else {
        window.location.href = '/api/spotify/connect';
      }
      
  };

  const handleAddSong = async (song: Song) => {
    if (!db) return;

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
    const maxOrder = Math.max(...queue.map((i) => i.order ?? 0), 0);

    await set(newRef, {
      ...song,
      timestampAdded: serverTimestamp(),
      order: maxOrder + 1000,
      addedByUserId: user?.uid || 'admin',
    });

    toast({
      title: 'Canción añadida',
      description: song.title,
    });
  };

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
      const res = await fetch(`/api/searchSpotify?term=${encodeURIComponent(searchTerm)}&mode=${config.searchMode}&playlistId=${config.playlistId}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (e: any) {
      console.error('Error búsqueda Spotify:', e);
      toast({ title: 'Error', description: e.message });
    } finally {
      setIsLoadingSearch(false);
    }
  }, [searchTerm, config, toast]);

  useEffect(() => {
    const delay = setTimeout(() => doSearch(), 500);
    return () => clearTimeout(delay);
  }, [searchTerm, doSearch]);

  const handleLoadAllSongs = async () => {
    if (!config?.playlistId) return;
    setIsLoadingSearch(true);
    try {
      const res = await fetch(`/api/searchSpotify?mode=playlist&playlistId=${config.playlistId}`);
      const data = await res.json();
      if(data.results){
        setSearchResults(data.results || []);
      }
    } catch (e: any) {
      toast({ title: 'Error al cargar', description: e.message });
    } finally {
      setIsLoadingSearch(false);
    }
  };

  if (loadingAuth) {
    return <div className="p-4">🔄 Cargando...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <div className="container mx-auto p-4 flex flex-col md:flex-row gap-6">
      {/* Columna principal */}
      <div className="flex-1 space-y-6">

        {/* ── Ahora Suena ── */}
        <Card>
          <CardHeader><CardTitle>Ahora Suena</CardTitle></CardHeader>
          <CardContent>
            {!currentPlaying ? (
              <p className="text-muted-foreground">Cargando...</p>
            ) : currentPlaying.isPlaying && currentPlaying.track ? (
              <div className="flex gap-4 items-center">
                <Image
                  src={currentPlaying.track.albumArtUrl || '/placeholder.png'}
                  alt="album"
                  width={64}
                  height={64}
                  className="rounded shadow"
                />
                <div className="flex-1">
                  <p className="font-semibold truncate ">{currentPlaying.track.name}</p>
                  <p className="text-sm text-muted-foreground truncate">{currentPlaying.track.artists.join(', ')}</p>
                  <progress
                    value={currentPlaying.track.progress_ms}
                    max={currentPlaying.track.duration_ms}
                    className="w-full h-1 mt-2 rounded bg-muted [&::-webkit-progress-value]:bg-primary"
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nada está sonando ahora mismo.</p>
            )}
          </CardContent>
        </Card>

        {/* ── Lista de la Cola ── */}
        <Card>
          <CardHeader><CardTitle><ListMusic /> Cola de Reproducción</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-80 p-4">
              {isLoadingQueue ? (
                <p>Cargando cola...</p>
              ) : queue.length > 0 ? (
                queue.map((song, idx) => (
                  <div key={song.id} className="flex items-center gap-3 p-2 hover:bg-secondary/30 rounded">
                    <span className="w-5 text-sm text-muted-foreground">{idx + 1}</span>
                    {song.albumArtUrl ? (
                      <img src={song.albumArtUrl} alt={song.title} className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <div className="h-10 w-10 bg-muted rounded flex items-center justify-center">
                        <Music className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 overflow-hidden">
                      <p className="truncate font-medium">{song.title}</p>
                      <p className="truncate text-sm text-muted-foreground">{song.artist}</p>
                      <p className="text-xs text-muted-foreground">Votos: {song.votes ?? 0}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="icon" onClick={() => handleMove(idx, -1)} disabled={idx === 0}><ArrowUp /></Button>
                      <Button size="icon" onClick={() => handleMove(idx, 1)} disabled={idx === queue.length - 1}><ArrowDown /></Button>
                      <Button size="icon" onClick={() => handleRemoveSong(song.id)}><Trash2 /></Button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground">La cola está vacía.</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* ── Buscador de canciones ── */}
        <Card>
          <CardHeader>
            <CardTitle><Search className="inline-block mr-2" />Buscar Canciones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 mb-2">
              <Input
                placeholder="Nombre de canción o artista"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <Button onClick={handleLoadAllSongs} disabled={isLoadingSearch}>
                {isLoadingSearch ? <RefreshCw className="animate-spin h-4 w-4" /> : 'Ver Todas'}
              </Button>
            </div>
            <ScrollArea className="h-64">
              <div className="space-y-2">
                {searchResults.map((song) => (
                  <div
                    key={song.spotifyTrackId}
                    className="flex items-center justify-between p-2 rounded hover:bg-secondary/40"
                  >
                    <div className="flex items-center gap-3">
                      {song.albumArtUrl ? (
                        <img src={song.albumArtUrl} className="w-10 h-10 rounded" alt={song.title} />
                      ) : (
                        <div className="w-10 h-10 bg-muted flex items-center justify-center rounded">
                          <Music className="text-muted-foreground" />
                        </div>
                      )}
                      <div className="truncate">
                        <p className="font-medium text-sm truncate">{song.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => handleAddSong(song)}>
                      <PlusCircle />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Columna lateral */}
      <div className="w-full md:w-80">
        <Card>
          <CardHeader><CardTitle><Settings /> Configuración</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Switch
                id="search-mode"
                checked={config.searchMode === 'playlist'}
                onCheckedChange={(checked) => {
                  if (!db) return;
                  update(ref(db, '/config'), { searchMode: checked ? 'playlist' : 'all' });
                }}
              />
              <Label htmlFor="search-mode">Buscar solo en playlist</Label>
            </div>
            {config.searchMode === 'playlist' && (
              <div className="flex gap-2 items-end">
                <Input
                  value={playlistIdInput}
                  onChange={(e) => setPlaylistIdInput(e.target.value)}
                />
                <Button
                  onClick={() => {
                    if (!db) return;
                    update(ref(db, '/config'), { playlistId: playlistIdInput.trim() });
                  }}
                >
                  Guardar
                </Button>
              </div>
            )}
            <div className="flex justify-center">
            <Button
  onClick={handleSpotifyAction}
  variant={
    spotifyStatus?.spotifyConnected && spotifyStatus?.tokensOk && spotifyStatus?.playbackAvailable
      ? 'default'           // verde: todo OK
      : spotifyStatus?.spotifyConnected && spotifyStatus?.tokensOk
      ? 'secondary'         // amarillo: conectado pero sin playback activo
      : 'destructive'       // rojo: desconectado o fallido
  }
>
  {spotifyStatus?.spotifyConnected ? 'Desconectar Spotify' : 'Conectar Spotify'}
</Button>

            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={() => router.push('/')}>
              <Home className="mr-2 h-4 w-4" /> Ir al Jukebox
            </Button>
            <Button variant="outline" onClick={() => auth && signOut(auth)}>
              <LogOut className="mr-2 h-4 w-4" /> Cerrar Sesión
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}