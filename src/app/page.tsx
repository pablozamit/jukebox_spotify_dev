'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import type { Song, SpotifyConfig } from '@/services/spotify';
import { Music, PlusCircle, CheckCircle, AlertTriangle } from 'lucide-react';
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

interface QueueSong extends Song {
  id: string;
  timestampAdded: number | object;
  addedByUserId?: string;
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

  useEffect(() => {
    if (!isDbValid) {
      setFirebaseError(
        'Firebase Database is not configured correctly. Jukebox features are unavailable.'
      );
      setIsLoadingQueue(false);
      setIsLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    let sessionId = sessionStorage.getItem('jukeboxUserSessionId');
    if (!sessionId) {
      sessionId = `user_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('jukeboxUserSessionId', sessionId);
    }
    setUserSessionId(sessionId);
  }, []);

  useEffect(() => {
    if (!db) {
      setIsLoadingConfig(false);
      return;
    }
    const cfgRef = ref(db, '/config');
    setIsLoadingConfig(true);
    const unsubscribe = onValue(
      cfgRef,
      snapshot => {
        const data = snapshot.val() || {};
        setSpotifyConfig({
          searchMode: data.searchMode ?? 'all',
          playlistId: data.playlistId,
          spotifyConnected: true
        });
        setIsLoadingConfig(false);
      },
      error => {
        console.error('Firebase Config Read Error:', error);
        setFirebaseError('Could not load Spotify configuration.');
        toast({
          title: 'Error',
          description: 'Could not load Spotify configuration.',
          variant: 'destructive'
        });
        setSpotifyConfig(null);
        setIsLoadingConfig(false);
      }
    );
    return () => unsubscribe();
  }, [toast]);

  useEffect(() => {
    if (!db) {
      setIsLoadingQueue(false);
      return;
    }
    console.log('PASO 1: Intentando leer la cola de Firebase...');
    const queueRef = ref(db, '/queue');
    setIsLoadingQueue(true);
    const unsubscribe = onValue(
      queueRef,
      snapshot => {
        const data = snapshot.val() || {};
        const items = Object.entries(data)
          .sort(([_, a], [__, b]) => {
            const oa = (a as any).order ?? (typeof (a as any).timestampAdded === 'number'
              ? (a as any).timestampAdded
              : 0);
            const ob = (b as any).order ?? (typeof (b as any).timestampAdded === 'number'
              ? (b as any).timestampAdded
              : 0);
            return oa - ob;
          })
          .map(([key, val]) => ({
            id: key,
            ...(val as any),
            timestampAdded: (val as any).order ?? (val as any).timestampAdded ?? 0
          }));
        setQueue(items);
        setIsLoadingQueue(false);
        if (userSessionId) {
          const has = items.some(song => song.addedByUserId === userSessionId);
          setCanAddSong(!has);
        }
      },
      error => {
        console.error('Firebase Queue Read Error:', error);
        setFirebaseError('Could not load the song queue.');
        toast({
          title: 'Error',
          description: 'Could not load the song queue.',
          variant: 'destructive'
        });
        setIsLoadingQueue(false);
      }
    );
    return () => unsubscribe();
  }, [userSessionId, toast]);

  const handleSearch = useCallback(async () => {
    if (!searchTerm.trim() || isLoadingConfig || spotifyConfig === null) {
      setSearchResults([]);
      return;
    }
    setIsLoadingSearch(true);
    try {
      const results = await searchSpotify(searchTerm, spotifyConfig);
      setSearchResults(results);
    } catch (e: any) {
      console.error('Spotify Search Error:', e);
      toast({
        title: 'Search Error',
        description: 'Could not fetch songs from Spotify.',
        variant: 'destructive'
      });
      setSearchResults([]);
    } finally {
      setIsLoadingSearch(false);
    }
  }, [searchTerm, spotifyConfig, isLoadingConfig, toast]);

  useEffect(() => {
    const timeout = setTimeout(handleSearch, 500);
    return () => clearTimeout(timeout);
  }, [searchTerm, handleSearch]);

  const handleAddSong = async (song: Song) => {
    if (!db) {
      toast({
        title: 'Error',
        description: 'Database connection is unavailable.',
        variant: 'destructive'
      });
      return;
    }
    if (!canAddSong || !userSessionId) {
      toast({
        title: 'Cannot Add Song',
        description: userSessionId
          ? 'You already have a song in the queue.'
          : 'Cannot identify user session.',
        variant: 'destructive'
      });
      return;
    }
    const alreadyInQueue = queue.some(q => q.spotifyTrackId === song.spotifyTrackId);
    if (alreadyInQueue) {
      toast({
        title: 'Already in Queue',
        description: `${song.title} is already in the queue.`,
        variant: 'destructive'
      });
      return;
    }
    const queueRef = ref(db, '/queue');
    const newRef = push(queueRef);
    let order: number | object = serverTimestamp();
    if (queue.length > 0) {
      const last = queue[queue.length - 1];
      const lastVal = typeof last.timestampAdded === 'number'
        ? last.timestampAdded
        : 0;
      order = lastVal + 1000;
    }
    const newData = {
      ...song,
      addedByUserId: userSessionId,
      timestampAdded: serverTimestamp(),
      order
    };
    try {
      await set(newRef, newData);
      toast({
        title: 'Song Added!',
        description: `${song.title} by ${song.artist} added to the queue.`,
        action: <ToastAction altText="Okay">Okay</ToastAction>
      });
      setSearchTerm('');
      setSearchResults([]);
    } catch (e) {
      console.error('Firebase Write Error:', e);
      toast({
        title: 'Error Adding Song',
        description: 'Could not add the song to the queue.',
        variant: 'destructive'
      });
    }
  };

  if (
    firebaseError &&
    !isLoadingQueue &&
    !isLoadingConfig &&
    isMounted
  ) {
    return (
      <div className="container mx-auto p-4 flex justify-center items-center min-h-screen">
        <Card className="w-full max-w-md shadow-lg border border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-6 w-6" /> Error Occurred
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-center text-destructive-foreground">
              {firebaseError}
            </p>
          </CardContent>
          <CardFooter>
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 flex flex-col md:flex-row gap-4 min-h-screen bg-background">
      {/* Search Section */}
      <div className="w-full md:w-1/2 lg:w-1/3">
        <Card className="shadow-lg rounded-lg border border-border">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold flex items-center gap-2">
              <Music className="h-6 w-6" /> Find Your Jam
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="search"
              placeholder={
                isLoadingConfig
                  ? 'Loading settings...'
                  : spotifyConfig?.searchMode === 'playlist'
                  ? 'Search playlist...'
                  : 'Search Spotify...'
              }
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              disabled={isLoadingConfig || !isDbValid}
            />
            <Separator />
            <ScrollArea className="h-[300px] md:h-[400px] pr-3">
              {isLoadingSearch ? (
                <>
                  <Skeleton className="h-12 w-full rounded-md" />
                  <Skeleton className="h-12 w-full rounded-md" />
                  <Skeleton className="h-12 w-full rounded-md" />
                </>
              ) : searchResults.length > 0 ? (
                <ul className="space-y-2">
                  {searchResults.map(song => {
                    const alreadyInQueue = queue.some(
                      q => q.spotifyTrackId === song.spotifyTrackId
                    );
                    return (
                      <li
                        key={song.spotifyTrackId}
                        className="flex items-center justify-between p-2 rounded-md hover:bg-secondary transition-colors"
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          {song.albumArtUrl && (
                            <img
                              src={song.albumArtUrl}
                              alt={`${song.title} album art`}
                              className="h-10 w-10 rounded object-cover flex-shrink-0"
                            />
                          )}
                          <div className="overflow-hidden">
                            <p
                              className="font-medium truncate"
                              title={song.title}
                            >
                              {song.title}
                            </p>
                            <p
                              className="text-sm text-muted-foreground truncate"
                              title={song.artist}
                            >
                              {song.artist}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleAddSong(song)}
                          disabled={
                            !canAddSong || !db || alreadyInQueue
                          }
                          aria-label={
                            alreadyInQueue
                              ? `${song.title} already in queue`
                              : `Add ${song.title} to queue`
                          }
                        >
                          {alreadyInQueue ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : (
                            <PlusCircle className="h-5 w-5" />
                          )}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-center text-muted-foreground py-4">
                  {isLoadingConfig
                    ? 'Loading...'
                    : searchTerm
                    ? 'No songs found.'
                    : spotifyConfig?.searchMode === 'playlist'
                    ? 'Search within the selected playlist.'
                    : 'Start typing to search all Spotify.'}
                </p>
              )}
            </ScrollArea>
            {!canAddSong && isMounted && (
              <p className="text-sm text-center text-destructive mt-2 px-2">
                You can add another song after yours has played or been removed.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Queue Section */}
      <div className="w-full md:w-1/2 lg:w-2/3">
        <Card className="shadow-lg rounded-lg border border-border h-full flex flex-col">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold flex items-center gap-2">
              Up Next
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-grow overflow-hidden p-0">
            <ScrollArea className="h-full p-6">
              {isLoadingQueue ? (
                <>
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex items-center space-x-3 p-3">
                      <Skeleton className="h-10 w-10 rounded" />
                      <div className="space-y-1 flex-1">
                        <Skeleton className="h-4 w-3/4 rounded" />
                        <Skeleton className="h-3 w-1/2 rounded" />
                      </div>
                      <Skeleton className="h-6 w-6 rounded-full" />
                    </div>
                  ))}
                </>
              ) : queue.length > 0 ? (
                <ul className="space-y-3">
                  {queue.map((song, idx) => (
                    <li
                      key={song.id}
                      className="flex items-center gap-3 p-3 rounded-md hover:bg-secondary/50"
                    >
                      <span className="w-6 text-center">{idx + 1}</span>
                      {song.albumArtUrl ? (
                        <img
                          src={song.albumArtUrl}
                          alt={`${song.title} album art`}
                          className="h-10 w-10 rounded object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                          <Music className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-grow overflow-hidden">
                        <p className="font-medium truncate" title={song.title}>
                          {song.title}
                        </p>
                        <p
                          className="text-sm text-muted-foreground truncate"
                          title={song.artist}
                        >
                          {song.artist}
                        </p>
                      </div>
                      {song.addedByUserId === userSessionId && (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-center py-10">
                  {isMounted && !isDbValid
                    ? 'Queue unavailable due to database error.'
                    : 'The queue is empty. Add a song!'}
                </p>
              )}
            </ScrollArea>
          </CardContent>
          {isMounted && !isDbValid && (
            <CardFooter className="border-t px-6 py-3 bg-destructive/10">
              <p className="text-sm text-destructive flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Queue features are unavailable due to a database error.
              </p>
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
}
