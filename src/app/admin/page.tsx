'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth, db, isDbValid } from '@/lib/firebase';
import { ref, onValue, remove, update } from 'firebase/database';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  Trash2,
  ArrowUp,
  ArrowDown,
  Settings,
  ListMusic,
  Music,
  LogOut,
  Home, // Import Home icon
} from 'lucide-react';

interface QueueSong {
  spotifyTrackId: string;
  title: string;
  artist: string;
  albumArtUrl?: string;
  id: string;
  order?: number;
  addedByUserId?: string;
  votes?: number;
}

export default function AdminPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [queue, setQueue] = useState<QueueSong[]>([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState(true);
  const [config, setConfig] = useState<{ searchMode: 'all' | 'playlist'; playlistId?: string }>({ searchMode: 'all' });
  const [playlistIdInput, setPlaylistIdInput] = useState('');
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false);

  useEffect(() => {
    if (!auth) {
      setLoadingAuth(false);
      router.push('/admin/login');
      return;
    }
    const unsub = onAuthStateChanged(auth, (current) => {
      if (current) {
        setUser(current);
      } else {
        router.push('/admin/login');
      }
      setLoadingAuth(false);
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!db || !user) {
      setIsLoadingQueue(false);
      return;
    }
    const queueRef = ref(db, '/queue');
    setIsLoadingQueue(true);
    const unsub = onValue(queueRef, (snapshot) => {
      const data = snapshot.val() || {};
      const items = Object.entries(data)
        .sort(([, a], [, b]) => ((a as any).order ?? 0) - ((b as any).order ?? 0))
        .map(([key, val]) => ({ id: key, ...(val as any) }));
      setQueue(items as QueueSong[]);
      setIsLoadingQueue(false);
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!db || !user) {
      setIsLoadingConfig(false);
      return;
    }
    const cfgRef = ref(db, '/config');
    setIsLoadingConfig(true);
    const unsub = onValue(cfgRef, (snapshot) => {
      const data = snapshot.val() || { searchMode: 'all' };
      setConfig({ searchMode: data.searchMode, playlistId: data.playlistId });
      setPlaylistIdInput(data.playlistId || '');
      setIsLoadingConfig(false);
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    const checkSpotify = async () => {
      try {
        const res = await fetch('/api/spotify/current');
        const data = await res.json();
        setIsSpotifyConnected(!data.error);
      } catch {
        setIsSpotifyConnected(false);
      }
    };
    checkSpotify();
  }, []);

  const handleRemoveSong = async (songId: string) => {
    if (!db) return;
    await remove(ref(db, `/queue/${songId}`));
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
    await update(ref(db), updates);
  };

  const handleSpotifyAction = async () => {
    if (isSpotifyConnected) {
      await fetch('/api/spotify/disconnect', { method: 'POST' });
      setIsSpotifyConnected(false);
    } else {
      window.location.href = '/api/spotify/connect';
    }
  };

  // 🔁 Sincronización automática con Spotify
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/spotify/sync');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Error al sincronizar');
        if (json.action === 'started') {
          toast({
            title: '🎵 Reproducción iniciada',
            description: `Ahora suena: ${json.track?.title}`,
          });
        }
      } catch (e: any) {
        console.error('Error en sincronización automática:', e.message);
      }
    }, 5000); // cada 5 segundos

    return () => clearInterval(interval);
  }, [toast]);


  if (loadingAuth) {
    return <div>🔄 Comprobando sesión…</div>;
  }

  return (
    <div className="container mx-auto p-4 flex flex-col md:flex-row gap-6">
      <div className="flex-1">
        <Card className="mb-6 md:mb-0">
          <CardHeader className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <ListMusic /> Gestionar Cola
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-80 p-4">
              {isLoadingQueue ? (
                [...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center space-x-3 p-3">
                    <Skeleton className="h-10 w-10 rounded object-cover flex-shrink-0" />
                    <div className="space-y-1 flex-1">
                      <Skeleton className="h-4 w-3/4 rounded" />
                      <Skeleton className="h-3 w-1/2 rounded" />
                    </div>
                    <Skeleton className="h-8 w-8 rounded-md" />
                    <Skeleton className="h-8 w-8 rounded-md" />
                    <Skeleton className="h-8 w-8 rounded-md" />
                  </div>
                ))
              ) : queue.length > 0 ? (
                queue.map((song, idx) => (
                  <div key={song.id} className="flex items-center p-3 gap-3 hover:bg-secondary/50 rounded-md">
                    <span className="w-6 text-center">{idx + 1}</span>
                    {song.albumArtUrl ? (
                      <img src={song.albumArtUrl} alt={song.title} className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                        <Music className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 overflow-hidden">
                      <p className="truncate font-medium">{song.title}</p>
                      <p className="truncate text-sm text-muted-foreground">{song.artist}</p>
                      <p className="text-sm text-muted-foreground">Votos: {song.votes ?? 0}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="icon" onClick={() => handleMove(idx, -1)} disabled={idx === 0}><ArrowUp /></Button>
                      <Button size="icon" onClick={() => handleMove(idx, 1)} disabled={idx === queue.length - 1}><ArrowDown /></Button>
                      <Button size="icon" onClick={() => handleRemoveSong(song.id)}><Trash2 /></Button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center py-10">La cola está vacía. ¡Añade canciones!</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <div className="w-full md:w-80">
        <Card>
          <CardHeader className="flex items-center gap-2">
            <Settings /> Configuración
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Switch
                id="search-mode"
                checked={config.searchMode === 'playlist'}
                onCheckedChange={(checked) => {
                  if (!db) return;
                  update(ref(db, '/config'), { searchMode: checked ? 'playlist' : 'all' });
                }}
                disabled={isLoadingConfig || !isDbValid}
              />
              <Label htmlFor="search-mode">Buscar solo en playlist</Label>
            </div>

            {config.searchMode === 'playlist' && (
              <div className="flex gap-2 items-end">
                <Input
                  value={playlistIdInput}
                  onChange={(e) => setPlaylistIdInput(e.target.value)}
                  disabled={isLoadingConfig || !isDbValid}
                  placeholder="ID de Playlist"
                />
                <Button
                  onClick={() => {
                    const id = playlistIdInput.trim();
                    if (!db || !id) return;
                    update(ref(db, '/config'), { playlistId: id });
                  }}
                  disabled={!playlistIdInput.trim() || isLoadingConfig || !isDbValid}
                >
                  Guardar
                </Button>
              </div>
            )}

            <div className="mt-4 flex justify-center">
              <Button
                onClick={handleSpotifyAction}
                size="sm"
                variant={isSpotifyConnected ? 'destructive' : 'outline'}
                disabled={!isDbValid}
              >
                {isSpotifyConnected ? 'Desconectar Spotify' : 'Conectar Spotify'}
              </Button>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between gap-2">
              {/* New 'Go to Jukebox' button */}
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