'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth, db, isDbValid } from '@/lib/firebase';
import { ref, onValue, update } from 'firebase/database';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface AdminConfig {
  searchMode: 'all' | 'playlist';
  playlistId?: string;
}

export default function AdminPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [config, setConfig] = useState<AdminConfig>({ searchMode: 'all' });
  const [playlistIdInput, setPlaylistIdInput] = useState('');
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);

  // ─── Protección de la ruta ───────────────────────────────────────────────────
  useEffect(() => {
    if (!auth) {
      setLoadingAuth(false);
      router.push('/admin/login');
      return;
    }
    const unsub = onAuthStateChanged(auth, current => {
      if (current) {
        setUser(current);
      } else {
        router.push('/admin/login');
      }
      setLoadingAuth(false);
    });
    return () => unsub();
  }, [router]);

  // ─── Leer configuración de Firebase ─────────────────────────────────────────
  useEffect(() => {
    if (!db || !user) {
      setIsLoadingConfig(false);
      return;
    }

    const cfgRef = ref(db, '/config');
    setIsLoadingConfig(true);

    const unsub = onValue(
      cfgRef,
      snapshot => {
        const data = snapshot.val() || {};
        setConfig({
          searchMode: data.searchMode ?? 'all',
          playlistId: data.playlistId
        });
        setPlaylistIdInput(data.playlistId ?? '');
        setIsLoadingConfig(false);
      },
      error => {
        console.error('Error leyendo config:', error);
        toast({
          title: 'Error',
          description: 'No se pudo cargar la configuración.',
          variant: 'destructive'
        });
        setIsLoadingConfig(false);
      }
    );

    return () => unsub();
  }, [user, toast]);

  // ─── Control de switch: actualiza /config/searchMode ────────────────────────
  const handleSearchModeToggle = (checked: boolean) => {
    if (!db) return;  // <<< null-check
    const newMode: AdminConfig['searchMode'] = checked ? 'playlist' : 'all';
    update(ref(db, '/config'), { searchMode: newMode })
      .then(() => {
        setConfig(prev => ({ ...prev, searchMode: newMode }));
      })
      .catch(err => {
        console.error('Error actualizando searchMode:', err);
        toast({
          title: 'Error',
          description: 'No se pudo actualizar el modo de búsqueda.',
          variant: 'destructive'
        });
      });
  };

  // ─── Control de Save: actualiza /config/playlistId ───────────────────────────
  const handlePlaylistIdSave = () => {
    const id = playlistIdInput.trim();
    if (!db || !id) return;  // <<< null-check
    update(ref(db, '/config'), { playlistId: id })
      .then(() => {
        setConfig(prev => ({ ...prev, playlistId: id }));
        toast({ title: 'Guardado', description: 'Playlist ID actualizado.' });
      })
      .catch(err => {
        console.error('Error actualizando playlistId:', err);
        toast({
          title: 'Error',
          description: 'No se pudo actualizar el Playlist ID.',
          variant: 'destructive'
        });
      });
  };

  // Si todavía estamos validando auth, mostramos indicador
  if (loadingAuth) {
    return <div>🔄 Comprobando autenticación…</div>;
  }

  return (
    <main className="p-6 max-w-md mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Admin Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="search-mode"
              checked={config.searchMode === 'playlist'}
              onCheckedChange={handleSearchModeToggle}
              disabled={isLoadingConfig || !isDbValid}
            />
            <Label htmlFor="search-mode">
              Buscar sólo en playlist
            </Label>
          </div>

          {config.searchMode === 'playlist' && (
            <div className="space-y-2">
              <Label htmlFor="playlist-id">Spotify Playlist ID</Label>
              <div className="flex space-x-2">
                <Input
                  id="playlist-id"
                  value={playlistIdInput}
                  onChange={e => setPlaylistIdInput(e.target.value)}
                  disabled={isLoadingConfig || !isDbValid}
                />
                <Button
                  onClick={handlePlaylistIdSave}
                  disabled={
                    !playlistIdInput.trim() ||
                    isLoadingConfig ||
                    !isDbValid
                  }
                >
                  Save
                </Button>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => {
              if (auth) signOut(auth);  // <<< null-check
            }}
          >
            Logout
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
