'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"; // Added CardFooter
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { Song, SpotifyConfig } from '@/services/spotify'; // Assuming Song interface is defined here
import { Music, PlusCircle, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'; // Added AlertTriangle
import { searchSpotify } from '@/services/spotify'; // Using stubbed functions for now
import { ref, onValue, push, set, serverTimestamp, get } from 'firebase/database'; // Added serverTimestamp, get
import { db, isDbValid } from '@/lib/firebase'; // Import centralized Firebase instance and validity flag
import { ToastAction } from '@/components/ui/toast'; // Import ToastAction explicitly

interface QueueSong extends Song {
  id: string; // Firebase key
  timestampAdded: number | object; // Can be number or Firebase ServerValue.TIMESTAMP
  addedByUserId?: string; // Simple identifier, maybe session based later
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
  const [spotifyConfig, setSpotifyConfig] = useState<SpotifyConfig | null>(null); // Store fetched config
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isMounted, setIsMounted] = useState(false); // State to track client-side mount
  const { toast } = useToast();

  // Set mounted state after component mounts
  useEffect(() => {
    setIsMounted(true);
  }, []);


  // Check Firebase availability on mount
    useEffect(() => {
      // Use the flag exported from firebase.ts
      if (!isDbValid) {
        setFirebaseError("Firebase Database is not configured correctly (check DATABASE_URL in .env). Jukebox features are unavailable.");
        setIsLoadingQueue(false); // Stop loading states
        setIsLoadingConfig(false);
      }
    }, []);

  // Generate or retrieve a simple user session ID
  useEffect(() => {
    let sessionId = sessionStorage.getItem('jukeboxUserSessionId');
    if (!sessionId) {
      sessionId = `user_${Math.random().toString(36).substring(2, 15)}`;
      sessionStorage.setItem('jukeboxUserSessionId', sessionId);
    }
    setUserSessionId(sessionId);
  }, []);

  // Fetch Spotify config from Firebase
  useEffect(() => {
      if (!db) { // Guard if DB object is null (implies isDbValid was false)
          setIsLoadingConfig(false);
          return;
      }
      setIsLoadingConfig(true);
      const configRef = ref(db, 'config');
      get(configRef).then((snapshot) => {
          if (snapshot.exists()) {
              setSpotifyConfig(snapshot.val() as SpotifyConfig);
          } else {
              console.warn("Admin configuration not found in Firebase.");
              // Set a default or handle the absence of config
              setSpotifyConfig({ searchMode: 'all', spotifyConnected: false }); // Default assumption
          }
          // Clear config-related error only if general DB isn't errored
          if (isDbValid) {
            // Clear error only if config loading succeeds AND db is generally valid
            // This prevents overriding the DB validity error if config loads fine
            if (firebaseError === "Could not load Spotify configuration.") {
                 setFirebaseError(null);
            }
          }
      }).catch((error) => {
          console.error("Firebase Config Read Error:", error);
          // Only set error if the DB was supposed to be valid
          if (isDbValid) {
            setFirebaseError("Could not load Spotify configuration.");
            toast({
                title: "Error",
                description: "Could not load Spotify configuration.",
                variant: "destructive",
            });
          }
          setSpotifyConfig(null); // Set config to null on error
      }).finally(() => {
          setIsLoadingConfig(false);
      });
  }, [toast]); // Removed db dependency


  // Fetch queue from Firebase Realtime Database
  useEffect(() => {
    if (!db) { // Guard against using db if initialization failed
        setIsLoadingQueue(false);
        return; // If db is not valid, stop here for this effect
    }

    // --- NUESTRO CONSOLE LOG ---
    console.log("PASO 1: Intentando leer la cola de Firebase...");
    // --------------------------

    const queueRef = ref(db, 'queue');
    setIsLoadingQueue(true);
    const unsubscribe = onValue(queueRef, (snapshot) => {
      const data = snapshot.val();
      const loadedQueue: QueueSong[] = [];
      if (data) {
        const sortedKeys = Object.keys(data).sort((a, b) => {
          // Sort by explicit 'order' field if present, otherwise use timestamp
          const orderA = data[a].order ?? (typeof data[a].timestampAdded === 'number' ? data[a].timestampAdded : 0);
          const orderB = data[b].order ?? (typeof data[b].timestampAdded === 'number' ? data[b].timestampAdded : 0);
          return orderA - orderB;
        });

        sortedKeys.forEach(key => {
            const songData = data[key];
            loadedQueue.push({
              id: key,
              ...songData,
               // Store the original timestamp or order value, handle server timestamp object
              timestampAdded: songData.order ?? songData.timestampAdded ?? 0
            });
        });
      }
      setQueue(loadedQueue);
        // Clear queue-related error on successful fetch only if no general DB error exists
        if (isDbValid) {
            // Clear error only if queue loading succeeds AND db is generally valid
            // Prevents overriding DB validity error if queue loads fine
            if (firebaseError === "Could not load the song queue. Check console for details.") {
                 setFirebaseError(null);
            }
        }
      setIsLoadingQueue(false);

      // Check if the current user can add a song
      if (userSessionId) {
        const userHasSongInQueue = loadedQueue.some(song => song.addedByUserId === userSessionId);
        setCanAddSong(!userHasSongInQueue);
      } else {
        setCanAddSong(false); // Cannot add if no session ID
      }

    }, (error) => {
      console.error("Firebase Queue Read Error:", error);
      // Only set error if the DB was supposed to be valid
      if (isDbValid) {
          setFirebaseError("Could not load the song queue. Check console for details.");
          toast({
            title: "Error",
            description: "Could not load the song queue.",
            variant: "destructive",
          });
      }
      setIsLoadingQueue(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, [userSessionId, toast]); // Removed db dependency


  const handleSearch = useCallback(async () => {
    if (!searchTerm.trim() || isLoadingConfig || spotifyConfig === null) {
      setSearchResults([]);
      if (!isLoadingConfig && spotifyConfig === null && isDbValid) {
          // Config failed to load, maybe show a message?
          console.warn("Cannot search: Spotify configuration is unavailable.");
      }
      return;
    }
    setIsLoadingSearch(true);
    try {
      // Use the fetched config
      const results = await searchSpotify(searchTerm, spotifyConfig);
      setSearchResults(results);
    } catch (error) {
      console.error("Spotify Search Error:", error);
      toast({
        title: "Search Error",
        description: "Could not fetch songs from Spotify.",
        variant: "destructive",
      });
      setSearchResults([]);
    } finally {
      setIsLoadingSearch(false);
    }
  }, [searchTerm, toast, spotifyConfig, isLoadingConfig]);

  // Debounced search
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      handleSearch();
    }, 500); // 500ms delay

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, handleSearch]);

  const handleAddSong = async (song: Song) => {
     if (!db) { // Check if DB is available
         toast({
             title: "Error",
             description: "Database connection is unavailable. Cannot add song.",
             variant: "destructive",
          });
         return;
     }
    if (!canAddSong || !userSessionId) {
       toast({
        title: "Cannot Add Song",
        description: !userSessionId ? "Cannot identify user session." : "You already have a song in the queue. Please wait until it plays.",
        variant: "destructive",
      });
      return;
    }

    const queueRef = ref(db, 'queue');
    const newSongRef = push(queueRef); // Generate a unique key

     // Determine the 'order' for the new song.
     // It should be placed after the last song's order/timestamp.
     // Use serverTimestamp as a fallback if the queue is empty or has no numeric timestamps/orders.
     let nextOrderValue: number | object = serverTimestamp();
     if (queue.length > 0) {
         const lastSong = queue[queue.length - 1];
         const lastOrder = typeof lastSong.timestampAdded === 'number' ? lastSong.timestampAdded : 0;
         // Add a small increment (e.g., 1000ms) to the last song's order/timestamp
         // Or use a larger base if timestamps are actual Date.now()
         nextOrderValue = lastOrder + 1000;
     }


    const newSongData: Omit<QueueSong, 'id' | 'timestampAdded'> & { timestampAdded: object, order: number | object } = {
      spotifyTrackId: song.spotifyTrackId,
      title: song.title,
      artist: song.artist,
      albumArtUrl: song.albumArtUrl,
      addedByUserId: userSessionId,
       // Use serverTimestamp() for reliable ordering across clients initially
      timestampAdded: serverTimestamp(),
      // Assign the calculated order value
      order: nextOrderValue,
    };

    try {
      await set(newSongRef, newSongData);
      toast({
        title: "Song Added!",
        description: `${song.title} by ${song.artist} added to the queue.`,
        action: <ToastAction altText="Okay">Okay</ToastAction>,
      });
      setSearchTerm(''); // Clear search after adding
      setSearchResults([]); // Clear results after adding
      // Let the onValue listener update canAddSong state based on the DB change
    } catch (error) {
      console.error("Firebase Write Error:", error);
      toast({
        title: "Error Adding Song",
        description: "Could not add the song to the queue.",
        variant: "destructive",
      });
    }
  };

  // Display Firebase Error if present (and DB was expected to be valid)
   if (firebaseError && !isLoadingQueue && !isLoadingConfig && isMounted) { // Show error card if error exists and not loading queue/config AND mounted
        return (
            <div className="container mx-auto p-4 flex justify-center items-center min-h-screen">
                <Card className="w-full max-w-md shadow-lg border border-destructive">
                    <CardHeader>
                        <CardTitle className="text-destructive flex items-center gap-2">
                            <AlertTriangle className="h-6 w-6" /> Error Occurred
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-center text-destructive-foreground">{firebaseError}</p>
                        <p className="text-center text-sm text-muted-foreground mt-2">
                         { !isDbValid
                              ? "Please ensure Firebase is correctly set up in your environment variables (.env file), especially the DATABASE_URL."
                              : "Please check the browser console for more details or try reloading the page."
                           }
                         </p>
                    </CardContent>
                     <CardFooter>
                         <Button variant="outline" onClick={() => window.location.reload()}>Reload Page</Button>
                     </CardFooter>
                </Card>
            </div>
        );
   }


  return (
    <div className="container mx-auto p-4 flex flex-col md:flex-row gap-4 min-h-screen bg-background">
      {/* Search and Results Section */}
      <div className="w-full md:w-1/2 lg:w-1/3">
        <Card className="shadow-lg rounded-lg border border-border">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold text-primary flex items-center gap-2">
              <Music className="h-6 w-6" /> Find Your Jam
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="search"
              placeholder={isLoadingConfig ? "Loading settings..." : (spotifyConfig?.searchMode === 'playlist' ? `Search playlist...` : `Search Spotify...`)}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="text-base md:text-sm"
              disabled={isLoadingConfig || !isDbValid} // Disable if loading config or if DB is invalid
            />
            <Separator />
            <ScrollArea className="h-[300px] md:h-[400px] pr-3">
              {isLoadingSearch ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full rounded-md" />
                  <Skeleton className="h-12 w-full rounded-md" />
                  <Skeleton className="h-12 w-full rounded-md" />
                </div>
              ) : searchResults.length > 0 ? (
                <ul className="space-y-2">
                  {searchResults.map((song) => (
                    <li key={song.spotifyTrackId} className="flex items-center justify-between p-2 rounded-md hover:bg-secondary transition-colors">
                      <div className='flex items-center gap-2 overflow-hidden'>
                         {song.albumArtUrl && (
                             <img src={song.albumArtUrl} alt={`${song.title} album art`} className="h-10 w-10 rounded object-cover flex-shrink-0"/>
                         )}
                         <div className='overflow-hidden'>
                             <p className="font-medium text-foreground truncate" title={song.title}>{song.title}</p>
                             <p className="text-sm text-muted-foreground truncate" title={song.artist}>{song.artist}</p>
                         </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleAddSong(song)}
                        disabled={!canAddSong || !db} // Also disable if DB is not available
                        aria-label={`Add ${song.title} to queue`}
                        className="text-accent disabled:text-muted-foreground ml-2"
                      >
                        <PlusCircle className="h-5 w-5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-center text-muted-foreground py-4">
                  {isLoadingConfig ? "Loading..." : (searchTerm ? "No songs found." : (spotifyConfig?.searchMode === 'playlist' ? "Search within the selected playlist." : "Start typing to search all Spotify."))}
                   {/* Conditional rendering only when mounted to prevent hydration error */}
                   {isMounted && !isDbValid && (
                     <span className="block text-xs text-destructive/80 mt-1">
                       Search disabled due to DB error.
                     </span>
                   )}
                </p>
              )}
            </ScrollArea>
               {/* Conditional rendering only when mounted to prevent hydration error */}
               {isMounted && !canAddSong && !isLoadingQueue && isDbValid && (
                 <p className="text-sm text-center text-destructive mt-2 px-2">
                   You can add another song after yours has played or been removed.
                 </p>
               )}
               {/* Conditional rendering only when mounted */}
               {isMounted && !isDbValid && (
                 <p className="text-xs text-center text-destructive/80 mt-1 px-2">
                     Database connection issues might prevent adding songs.
                 </p>
               )}
          </CardContent>
        </Card>
      </div>

      {/* Queue Section */}
      <div className="w-full md:w-1/2 lg:w-2/3">
        <Card className="shadow-lg rounded-lg border border-border h-full flex flex-col">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold text-primary flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-list-music"><path d="M21 15V6"/><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/></svg>
              Up Next
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-grow overflow-hidden p-0">
             <ScrollArea className="h-full p-6">
               {isLoadingQueue ? (
                 <div className="space-y-3">
                   {[...Array(3)].map((_, i) => (
                     <div key={i} className="flex items-center space-x-3 p-3">
                       <Skeleton className="h-10 w-10 rounded object-cover flex-shrink-0" />
                       <div className="space-y-1 flex-1">
                         <Skeleton className="h-4 w-3/4 rounded" />
                         <Skeleton className="h-3 w-1/2 rounded" />
                       </div>
                       <Skeleton className="h-6 w-6 rounded-full" />
                     </div>
                   ))}
                 </div>
               ) : queue.length > 0 ? (
                 <ul className="space-y-3">
                   {queue.map((song, index) => (
                     <li key={song.id} className="flex items-center gap-3 p-3 rounded-md bg-card border border-border transition-colors hover:bg-secondary/50">
                       <span className="text-lg font-medium text-primary w-6 text-center flex-shrink-0">{index + 1}</span>
                       {song.albumArtUrl ? (
                           <img src={song.albumArtUrl} alt={`${song.title} album art`} className="h-10 w-10 rounded object-cover flex-shrink-0"/>
                       ) : (
                         <div className="h-10 w-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                           <Music className="h-5 w-5 text-muted-foreground" />
                         </div>
                       )}
                       <div className="flex-grow overflow-hidden">
                         <p className="font-medium text-foreground truncate" title={song.title}>{song.title}</p>
                         <p className="text-sm text-muted-foreground truncate" title={song.artist}>{song.artist}</p>
                       </div>
                       {song.addedByUserId === userSessionId && (
                         <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 ml-auto" title="Added by you"/>
                       )}
                     </li>
                   ))}
                 </ul>
               ) : (
                 <p className="text-center text-muted-foreground py-10">
                   {/* Conditional rendering based on mounted state */}
                   {isMounted && !isDbValid ? "Queue unavailable due to database error." : "The queue is empty. Add a song!"}
                 </p>
               )}
             </ScrollArea>
          </CardContent>
           {/* Conditional rendering based on mounted state */}
           {isMounted && !isDbValid && (
                 <CardFooter className="border-t px-6 py-3 bg-destructive/10">
                     <p className="text-sm text-destructive flex items-center gap-2">
                         <AlertTriangle className="h-4 w-4" /> Queue features are unavailable due to a database configuration error.
                     </p>
                 </CardFooter>
             )}
        </Card>
      </div>
    </div>
  );
}