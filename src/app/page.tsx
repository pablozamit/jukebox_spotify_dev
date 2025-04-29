'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { Song } from '@/services/spotify'; // Assuming Song interface is defined here
import { Music, PlusCircle, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'; // Added AlertTriangle
import { searchSpotify } from '@/services/spotify'; // Using stubbed functions for now
import { ref, onValue, push, set, serverTimestamp } from 'firebase/database'; // Added serverTimestamp
import { db } from '@/lib/firebase'; // Import centralized Firebase instance
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
  const { toast } = useToast();

  // Check Firebase availability on mount
   useEffect(() => {
     if (!db) {
       setFirebaseError("Firebase Database is not configured correctly. Please check the setup.");
       setIsLoadingQueue(false); // Stop loading state if DB is unavailable
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

  // Fetch queue from Firebase Realtime Database
  useEffect(() => {
    if (!db) { // Guard against using db if initialization failed
        setIsLoadingQueue(false);
        return;
    }

    const queueRef = ref(db, 'queue');
    setIsLoadingQueue(true);
    const unsubscribe = onValue(queueRef, (snapshot) => {
      const data = snapshot.val();
      const loadedQueue: QueueSong[] = [];
      if (data) {
        Object.keys(data).forEach(key => {
            // Ensure timestampAdded is treated as a number for sorting
            const songData = data[key];
            loadedQueue.push({
              id: key,
              ...songData,
              timestampAdded: typeof songData.timestampAdded === 'number' ? songData.timestampAdded : 0 // Handle server timestamp object if needed, default to 0 for sorting
            });
        });
        // Sort by timestampAdded
        loadedQueue.sort((a, b) => (a.timestampAdded as number) - (b.timestampAdded as number));
      }
      setQueue(loadedQueue);
      setFirebaseError(null); // Clear previous error on successful fetch
      setIsLoadingQueue(false);

      // Check if the current user can add a song
      if (userSessionId) {
        const userHasSongInQueue = loadedQueue.some(song => song.addedByUserId === userSessionId);
        setCanAddSong(!userHasSongInQueue);
      } else {
        setCanAddSong(false); // Cannot add if no session ID
      }

    }, (error) => {
      console.error("Firebase Read Error:", error);
      setFirebaseError("Could not load the song queue. Check console for details.");
      toast({
        title: "Error",
        description: "Could not load the song queue.",
        variant: "destructive",
      });
      setIsLoadingQueue(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, [userSessionId, toast]); // Removed db from dependencies as it's stable after init


  const handleSearch = useCallback(async () => {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      return;
    }
    setIsLoadingSearch(true);
    try {
      // TODO: Read config from Firebase to determine search mode ('all' or 'playlist')
      // For now, assuming 'all'. Fetching config requires db to be available.
      const config = { searchMode: 'all' } as const; // Placeholder
      if (!db && config.searchMode === 'playlist') {
        console.warn("Cannot fetch config for playlist search mode as DB is unavailable.");
        // Optionally fall back to 'all' or show error
      }
      const results = await searchSpotify(searchTerm, config);
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
  }, [searchTerm, toast]); // Removed db dependency for now

  // Debounced search
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      handleSearch();
    }, 500); // 500ms delay

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, handleSearch]);

  const handleAddSong = async (song: Song) => {
     if (!db) {
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
        description: "You already have a song in the queue. Please wait until it plays.",
        variant: "destructive",
      });
      return;
    }

    const queueRef = ref(db, 'queue');
    const newSongRef = push(queueRef); // Generate a unique key

    const newSongData: Omit<QueueSong, 'id'> = {
      ...song,
      // Use Firebase server timestamp for accurate ordering
      timestampAdded: serverTimestamp(),
      addedByUserId: userSessionId,
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
      // setCanAddSong(false); // Let the onValue listener update this state based on the DB
    } catch (error) {
      console.error("Firebase Write Error:", error);
      toast({
        title: "Error Adding Song",
        description: "Could not add the song to the queue.",
        variant: "destructive",
      });
    }
  };

  // Display Firebase Error if present
   if (firebaseError) {
       return (
           <div className="container mx-auto p-4 flex justify-center items-center min-h-screen">
               <Card className="w-full max-w-md shadow-lg border border-destructive">
                   <CardHeader>
                       <CardTitle className="text-destructive flex items-center gap-2">
                           <AlertTriangle className="h-6 w-6" /> Configuration Error
                       </CardTitle>
                   </CardHeader>
                   <CardContent>
                       <p className="text-center text-destructive-foreground">{firebaseError}</p>
                       <p className="text-center text-sm text-muted-foreground mt-2">Please ensure Firebase is correctly set up in your environment variables (.env file) and the configuration is valid.</p>
                   </CardContent>
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
              placeholder="Search Spotify for songs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="text-base md:text-sm"
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
                      <div>
                        <p className="font-medium text-foreground">{song.title}</p>
                        <p className="text-sm text-muted-foreground">{song.artist}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleAddSong(song)}
                        disabled={!canAddSong}
                        aria-label={`Add ${song.title} to queue`}
                        className="text-accent disabled:text-muted-foreground"
                      >
                        <PlusCircle className="h-5 w-5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-center text-muted-foreground py-4">
                  {searchTerm ? "No songs found." : "Start typing to search."}
                </p>
              )}
            </ScrollArea>
              {!canAddSong && (
                 <p className="text-sm text-center text-destructive mt-2">
                   You can add another song after yours has played.
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
                   <div className="flex items-center space-x-3">
                     <Skeleton className="h-10 w-10 rounded-full" />
                     <div className="space-y-1 flex-1">
                       <Skeleton className="h-4 w-3/4 rounded" />
                       <Skeleton className="h-3 w-1/2 rounded" />
                     </div>
                   </div>
                   <div className="flex items-center space-x-3">
                     <Skeleton className="h-10 w-10 rounded-full" />
                     <div className="space-y-1 flex-1">
                       <Skeleton className="h-4 w-3/4 rounded" />
                       <Skeleton className="h-3 w-1/2 rounded" />
                     </div>
                   </div>
                   <div className="flex items-center space-x-3">
                     <Skeleton className="h-10 w-10 rounded-full" />
                     <div className="space-y-1 flex-1">
                       <Skeleton className="h-4 w-3/4 rounded" />
                       <Skeleton className="h-3 w-1/2 rounded" />
                     </div>
                   </div>
                 </div>
               ) : queue.length > 0 ? (
                 <ul className="space-y-3">
                   {queue.map((song, index) => (
                     <li key={song.id} className="flex items-center gap-3 p-3 rounded-md bg-card border border-border transition-colors hover:bg-secondary/50">
                       <span className="text-lg font-medium text-primary w-6 text-center">{index + 1}</span>
                       <Music className="h-5 w-5 text-accent flex-shrink-0" />
                       <div className="flex-grow overflow-hidden">
                         <p className="font-medium text-foreground truncate" title={song.title}>{song.title}</p>
                         <p className="text-sm text-muted-foreground truncate" title={song.artist}>{song.artist}</p>
                       </div>
                       {song.addedByUserId === userSessionId && (
                          <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" title="Added by you"/>
                       )}
                     </li>
                   ))}
                 </ul>
               ) : (
                 <p className="text-center text-muted-foreground py-10">
                   The queue is empty. Add a song!
                 </p>
               )}
             </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
