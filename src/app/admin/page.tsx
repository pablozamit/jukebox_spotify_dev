'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation'; // Use next/navigation for App Router
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card"; // Added CardFooter, CardDescription
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator"; // Import Separator
import { useToast } from "@/hooks/use-toast";
import type { Song } from '@/services/spotify';
import { Trash2, ArrowUp, ArrowDown, Settings, LogOut, Music, ListMusic, RefreshCw, WifiOff, Wifi, AlertTriangle } from 'lucide-react'; // Added AlertTriangle
import { onAuthStateChanged, signOut, User } from 'firebase/auth'; // Removed getAuth
import { ref, onValue, remove, set, update, serverTimestamp } from 'firebase/database'; // Removed getDatabase, added serverTimestamp
import { auth, db, isDbValid } from '@/lib/firebase'; // Import centralized Firebase instances AND validity flag
import { addSongToQueueWithAutoToken } from '@/services/spotify'; // Use the wrapper function

interface QueueSong extends Song {
  id: string; // Firebase key
  timestampAdded: number | object; // Allow object for serverTimestamp
  order?: number; // For potential reordering
  addedByUserId?: string; // Track who added the song
}

interface AdminConfig {
  searchMode: 'all' | 'playlist';
  playlistId?: string;
  spotifyConnected: boolean; // Track connection status
}

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [queue, setQueue] = useState<QueueSong[]>([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState(true);
  const [config, setConfig] = useState<AdminConfig | null>(null); // Can be null initially
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [playlistIdInput, setPlaylistIdInput] = useState('');
  const [firebaseError, setFirebaseError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

 // Check Firebase availability on mount
  useEffect(() => {
    // Use the flag exported from firebase.ts
    if (!isDbValid) {
      setFirebaseError("Firebase Database is not configured correctly (check DATABASE_URL in .env). Queue and config features are unavailable.");
      setIsLoadingQueue(false); // Stop loading states
      setIsLoadingConfig(false);
    }
     if (!auth) {
         setFirebaseError(prev => prev ? `${prev} Firebase Auth is also unavailable.` : "Firebase Auth is not configured correctly. Login/logout will not work.");
         setLoadingAuth(false); // Stop auth loading if auth service itself is missing
     }
  }, []);


  // Authentication Check
  useEffect(() => {
     if (!auth) return; // Don't check auth state if auth is not initialized

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        setUser(null);
        router.push('/admin/login'); // Redirect to login if not authenticated
      }
      setLoadingAuth(false);
    });
    return () => unsubscribe(); // Cleanup subscription
  }, [router]); // Removed auth dependency

  // Fetch Queue
  useEffect(() => {
    if (!user || !db) { // Don't fetch if not logged in or db unavailable (already handled by isDbValid check)
        setIsLoadingQueue(false);
        return;
    }

    const queueRef = ref(db, 'queue');
    setIsLoadingQueue(true);
    const unsubscribe = onValue(queueRef, (snapshot) => {
      const data = snapshot.val();
      const loadedQueue: QueueSong[] = [];
      if (data) {
        // Sort keys based on 'order' field primarily, then timestampAdded as fallback
        const sortedKeys = Object.keys(data).sort((a, b) => {
           const orderA = data[a].order ?? (typeof data[a].timestampAdded === 'number' ? data[a].timestampAdded : 0);
           const orderB = data[b].order ?? (typeof data[b].timestampAdded === 'number' ? data[b].timestampAdded : 0);
           return orderA - orderB;
        });

        sortedKeys.forEach(key => {
            const songData = data[key];
            loadedQueue.push({
                id: key,
                ...songData,
                // Store the original timestamp or order value
                timestampAdded: songData.order ?? songData.timestampAdded ?? 0
            });
        });
      }
      setQueue(loadedQueue);
      // Clear queue-related error only if general DB isn't errored
      if (isDbValid) {
        setFirebaseError(null);
      }
      setIsLoadingQueue(false);
    }, (error) => {
      console.error("Firebase Queue Read Error:", error);
      // Only set error if the DB was supposed to be valid
      if (isDbValid) {
          setFirebaseError("Could not load queue. Check console.");
          toast({ title: "Error", description: "Could not load queue.", variant: "destructive" });
      }
      setIsLoadingQueue(false);
    });
    return () => unsubscribe();
  }, [user, toast]); // Removed db dependency

  // Fetch Config
   useEffect(() => {
     if (!user || !db) { // Don't fetch if not logged in or db unavailable
        setIsLoadingConfig(false);
        return;
     }

     const configRef = ref(db, 'config');
     setIsLoadingConfig(true);
     const unsubscribe = onValue(configRef, (snapshot) => {
       const data = snapshot.val();
       if (data) {
         setConfig(data);
         setPlaylistIdInput(data.playlistId || ''); // Initialize input field
       } else {
         // Set default config if none exists in DB
         const defaultConfig: AdminConfig = { searchMode: 'all', spotifyConnected: false };
         set(configRef, defaultConfig).then(() => {
             setConfig(defaultConfig); // Set state after DB write confirmation
             setPlaylistIdInput('');
             console.log("Default config written to Firebase.");
         }).catch(err => {
             console.error("Failed to set default config:", err);
             if (isDbValid) { // Only show error if DB should be working
                 setFirebaseError("Failed to write default configuration.");
                 toast({ title: "Error", description: "Could not save default configuration.", variant: "destructive" });
             }
          });
       }
        // Clear config-related error only if general DB isn't errored
       if (isDbValid) {
           setFirebaseError(null);
       }
       setIsLoadingConfig(false);
     }, (error) => {
       console.error("Firebase Config Read Error:", error);
        // Only set error if the DB was supposed to be valid
       if (isDbValid) {
           setFirebaseError("Could not load configuration. Check console.");
           toast({ title: "Error", description: "Could not load configuration.", variant: "destructive" });
       }
       setIsLoadingConfig(false);
     });
     return () => unsubscribe();
   }, [user, toast]); // Removed db dependency

  const handleLogout = async () => {
    if (!auth) {
       toast({ title: "Error", description: "Authentication service unavailable.", variant: "destructive" });
       return;
    }
    try {
      await signOut(auth);
      router.push('/admin/login');
    } catch (error) {
      console.error("Logout Error:", error);
      toast({ title: "Logout Error", description: "Could not log out.", variant: "destructive" });
    }
  };

  const handleRemoveSong = async (songId: string, addedByUserId?: string) => {
     if (!db) {
         toast({ title: "Error", description: "Database unavailable.", variant: "destructive" });
         return;
     }
    const songRef = ref(db, `queue/${songId}`);
    try {
      await remove(songRef);
      toast({ title: "Song Removed", description: "Successfully removed from queue." });

      // Attempt to reset user's canAddSong status (conceptual)
       if (addedByUserId) {
            console.log(`Song added by ${addedByUserId} removed. Ideally, reset their status.`);
            // e.g., update(ref(db, `userStatus/${addedByUserId}`), { canAddSong: true });
       }

    } catch (error) {
      console.error("Firebase Remove Error:", error);
      toast({ title: "Error", description: "Could not remove song.", variant: "destructive" });
    }
  };

  // --- Reordering Logic (Assign explicit order numbers) ---
  const handleMove = async (index: number, direction: 'up' | 'down') => {
      if (!db) {
           toast({ title: "Error", description: "Database unavailable.", variant: "destructive" });
           return;
      };
      const newQueue = [...queue];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;

      if (targetIndex < 0 || targetIndex >= newQueue.length) {
          return; // Cannot move outside bounds
      }

      // Swap the items in the local array to prepare for updates
      const movingSong = newQueue[index];
      const targetSong = newQueue[targetIndex];
      newQueue[index] = targetSong;
      newQueue[targetIndex] = movingSong;

      // Prepare updates for Firebase: assign new 'order' based on the desired position
      const updates: { [key: string]: any } = {};
      newQueue.forEach((song, i) => {
          // Use index as the basis for order, multiplied by a factor for spacing
          // Or base it on timestamps for more stable ordering (e.g., Date.now() + i * 1000)
          updates[`/queue/${song.id}/order`] = i * 1000; // Simple index-based ordering
      });

      try {
          await update(ref(db), updates);
          toast({ title: "Queue Reordered", description: "Song position updated." });
          // onValue listener will handle the final state update from Firebase
      } catch (error) {
          console.error("Firebase Reorder Error:", error);
          toast({ title: "Error", description: "Could not reorder queue.", variant: "destructive" });
          // Optionally revert local state change if needed, though onValue should correct it
      }
  };
  // --- End Reordering Logic ---

  const handleConfigChange = async (updates: Partial<AdminConfig>) => {
      if (!db || !config) { // Need db and existing config to update
           toast({ title: "Error", description: "Database unavailable or config not loaded.", variant: "destructive" });
           return;
      };
      const configRef = ref(db, 'config');
      try {
          await update(configRef, updates);
          toast({ title: "Configuration Saved", description: "Settings updated successfully." });
          // State will update via the onValue listener
      } catch (error) {
          console.error("Firebase Config Update Error:", error);
          toast({ title: "Error", description: "Could not save settings.", variant: "destructive" });
      }
  };

  const handleSearchModeToggle = (checked: boolean) => {
    handleConfigChange({ searchMode: checked ? 'playlist' : 'all' });
  };

  const handlePlaylistIdSave = () => {
    if (config?.searchMode === 'playlist') {
      handleConfigChange({ playlistId: playlistIdInput.trim() });
    }
  };

  // Placeholder for Spotify OAuth flow
  const handleSpotifyConnect = () => {
    if (!db) {
         toast({ title: "Error", description: "Database unavailable. Cannot update Spotify status.", variant: "destructive" });
         return;
    }
    // TODO: Implement initiation of Spotify OAuth flow
    toast({ title: "Connect Spotify", description: "OAuth flow initiation not yet implemented.", variant: "default" });
    console.log("Initiate Spotify OAuth flow here...");

     // --- Mock connection state change ---
     // Only allow changing if config is loaded
     if (config) {
        handleConfigChange({ spotifyConnected: !config.spotifyConnected });
     }
     // --- End Mock ---
  };

  // Add next song to Spotify Queue using the wrapper function
  const handleAddNextToSpotify = async () => {
     if (!db) {
         toast({ title: "Error", description: "Database unavailable.", variant: "destructive" });
         return;
     }
    if (!config?.spotifyConnected) {
      toast({ title: "Not Connected", description: "Connect to Spotify first.", variant: "destructive" });
      return;
    }
    if (queue.length === 0) {
      toast({ title: "Queue Empty", description: "No songs to add.", variant: "default" });
      return;
    }

    const nextSong = queue[0];
    try {
      // Call the service wrapper function that handles tokens
      await addSongToQueueWithAutoToken(nextSong.spotifyTrackId);
      toast({ title: "Song Queued on Spotify", description: `${nextSong.title} added to Spotify playback.` });

      // Remove the song from *our* queue *after* successfully adding to Spotify
      await handleRemoveSong(nextSong.id, nextSong.addedByUserId);

    } catch (error) {
      console.error("Spotify Add Queue Error:", error);
      toast({ title: "Spotify Error", description: `Could not add song to Spotify queue. Error: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: "destructive" });
    }
  };


   // Display Firebase Error if present and not just loading
   if (firebaseError && !isLoadingQueue && !isLoadingConfig) {
       return (
           <div className="container mx-auto p-4 flex justify-center items-center min-h-screen">
                <Card className="w-full max-w-lg shadow-lg border border-destructive">
                   <CardHeader>
                       <CardTitle className="text-destructive flex items-center gap-2">
                           <AlertTriangle className="h-6 w-6" /> Runtime Error
                       </CardTitle>
                        <CardDescription>There was an issue with Firebase.</CardDescription>
                   </CardHeader>
                   <CardContent>
                       <p className="text-destructive-foreground">{firebaseError}</p>
                       <p className="text-sm text-muted-foreground mt-2">
                         { !isDbValid
                           ? "Please ensure Firebase is correctly set up in your environment variables (.env file), especially the DATABASE_URL."
                           : "Please check the browser console for more details and verify your Firebase project configuration."
                         }
                        </p>
                   </CardContent>
                   <CardFooter className="justify-between">
                       <Button variant="outline" onClick={() => window.location.reload()}>Reload Page</Button>
                        {auth && <Button onClick={handleLogout} variant="destructive">
                           <LogOut className="mr-2 h-4 w-4" /> Logout
                        </Button>}
                   </CardFooter>
               </Card>
           </div>
       );
   }


  if (loadingAuth || !user) {
    // Show loading spinner only if auth service itself is okay
    return (
      <div className="flex justify-center items-center min-h-screen">
        {auth && <RefreshCw className="h-8 w-8 animate-spin text-primary" />}
         {!auth && !firebaseError && <p className="text-muted-foreground">Auth service unavailable...</p>}
        {/* If firebaseError is set, the error card above should be shown instead */}
      </div>
    );
  }

  // Determine if DB operations should be disabled
  const disableDbOperations = !isDbValid;

  return (
    <div className="container mx-auto p-4 flex flex-col md:flex-row gap-6 min-h-screen bg-background">
       {/* Queue Management Section */}
      <div className="w-full md:w-2/3">
        <Card className="shadow-lg rounded-lg border border-border h-full flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-2xl font-semibold text-primary flex items-center gap-2">
              <ListMusic className="h-6 w-6" /> Manage Queue
            </CardTitle>
            <Button
                variant="outline"
                size="sm"
                onClick={handleAddNextToSpotify}
                disabled={queue.length === 0 || !config?.spotifyConnected || disableDbOperations} // Disable if DB error
                className="bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
              >
                <Music className="mr-2 h-4 w-4" /> Add Next to Spotify
              </Button>
          </CardHeader>
          <CardContent className="flex-grow overflow-hidden p-0">
            <ScrollArea className="h-full p-6">
              {isLoadingQueue ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => ( // Render 5 skeleton items
                    <div key={i} className="flex items-center space-x-3 p-3">
                       <Skeleton className="h-10 w-10 rounded object-cover flex-shrink-0" />
                       {/* <Skeleton className="h-5 w-5 rounded-full" /> */}
                      <div className="space-y-1 flex-1">
                        <Skeleton className="h-4 w-3/4 rounded" />
                        <Skeleton className="h-3 w-1/2 rounded" />
                      </div>
                      <Skeleton className="h-8 w-8 rounded-md" />
                      <Skeleton className="h-8 w-8 rounded-md" />
                      <Skeleton className="h-8 w-8 rounded-md" />
                    </div>
                  ))}
                </div>
              ) : queue.length > 0 ? (
                <ul className="space-y-3">
                  {queue.map((song, index) => (
                    <li key={song.id} className="flex items-center gap-3 p-3 rounded-md bg-card border border-border transition-shadow hover:shadow-md">
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
                         {/* Optionally display who added it */}
                         {/* {song.addedByUserId && <p className="text-xs text-muted-foreground/70 truncate">Added by: {song.addedByUserId.substring(0,10)}...</p>} */}
                      </div>
                      <div className="flex gap-1 ml-auto">
                         <Button
                           variant="ghost"
                           size="icon"
                           onClick={() => handleMove(index, 'up')}
                           disabled={index === 0 || disableDbOperations}
                           aria-label="Move song up"
                           className="text-muted-foreground hover:text-primary disabled:opacity-30"
                         >
                           <ArrowUp className="h-4 w-4" />
                         </Button>
                         <Button
                           variant="ghost"
                           size="icon"
                           onClick={() => handleMove(index, 'down')}
                           disabled={index === queue.length - 1 || disableDbOperations}
                           aria-label="Move song down"
                           className="text-muted-foreground hover:text-primary disabled:opacity-30"
                         >
                           <ArrowDown className="h-4 w-4" />
                         </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveSong(song.id, song.addedByUserId)}
                          disabled={disableDbOperations}
                          aria-label="Remove song"
                          className="text-destructive hover:bg-destructive/10 disabled:opacity-30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-center text-muted-foreground py-10">
                    {disableDbOperations ? "Queue unavailable due to database configuration issue." : "Queue is empty."}
                </p>
              )}
            </ScrollArea>
          </CardContent>
           {disableDbOperations && (
                <CardFooter className="border-t px-6 py-3">
                    <p className="text-sm text-destructive flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" /> Database features are disabled due to configuration error.
                    </p>
                </CardFooter>
            )}
        </Card>
      </div>

       {/* Settings & Actions Section */}
      <div className="w-full md:w-1/3 space-y-6">
         <Card className="shadow-lg rounded-lg border border-border">
           <CardHeader>
             <CardTitle className="text-xl font-semibold text-primary flex items-center gap-2">
               <Settings className="h-5 w-5" /> Settings
             </CardTitle>
           </CardHeader>
           <CardContent className="space-y-6">
             {isLoadingConfig || config === null ? ( // Show skeleton if loading or config is null (and DB is expected)
                <div className="space-y-4">
                   {isDbValid ? ( // Only show skeletons if DB was supposed to be valid
                     <>
                       <Skeleton className="h-8 w-full rounded-md" />
                       <Skeleton className="h-10 w-full rounded-md" />
                       <Skeleton className="h-10 w-full rounded-md" />
                     </>
                     ) : (
                     <p className='text-sm text-muted-foreground text-center'>Configuration unavailable.</p>
                    )}
                </div>
             ) : (
                <>
                 {/* Spotify Connection */}
                 <div className="flex items-center justify-between">
                   <Label htmlFor="spotify-connect" className="flex items-center gap-2">
                    {config.spotifyConnected ? <Wifi className="text-green-500"/> : <WifiOff className="text-destructive"/>}
                     Spotify Status
                   </Label>
                   <Button id="spotify-connect" onClick={handleSpotifyConnect} size="sm" variant={config.spotifyConnected ? "destructive" : "default"} disabled={disableDbOperations}>
                     {config.spotifyConnected ? 'Disconnect' : 'Connect'}
                   </Button>
                 </div>

                 <Separator />

                 {/* Search Mode */}
                 <div className="flex items-center space-x-2">
                   <Switch
                     id="search-mode"
                     checked={config.searchMode === 'playlist'}
                     onCheckedChange={handleSearchModeToggle}
                     aria-label="Toggle search mode between all Spotify and specific playlist"
                     disabled={disableDbOperations}
                   />
                   <Label htmlFor="search-mode">Use Specific Playlist</Label>
                 </div>

                 {/* Playlist ID Input (conditionally shown) */}
                 {config.searchMode === 'playlist' && (
                   <div className="space-y-2">
                     <Label htmlFor="playlist-id">Spotify Playlist ID</Label>
                     <div className="flex gap-2">
                       <Input
                         id="playlist-id"
                         value={playlistIdInput}
                         onChange={(e) => setPlaylistIdInput(e.target.value)}
                         placeholder="Enter Playlist ID"
                         disabled={config.searchMode !== 'playlist' || disableDbOperations}
                         className="flex-grow"
                       />
                       <Button onClick={handlePlaylistIdSave} size="sm" disabled={config.searchMode !== 'playlist' || !playlistIdInput.trim() || disableDbOperations}>Save</Button>
                     </div>
                   </div>
                 )}
               </>
             )}
           </CardContent>
             {disableDbOperations && (
                <CardFooter className="border-t px-6 py-3">
                    <p className="text-sm text-destructive flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" /> Settings cannot be saved.
                    </p>
                </CardFooter>
            )}
         </Card>

         {/* Admin Actions */}
         <Card className="shadow-lg rounded-lg border border-border">
          <CardHeader>
             <CardTitle className="text-xl font-semibold text-primary">Actions</CardTitle>
           </CardHeader>
           <CardContent>
             <Button onClick={handleLogout} variant="outline" className="w-full" disabled={!auth}>
               <LogOut className="mr-2 h-4 w-4" /> Logout
             </Button>
           </CardContent>
         </Card>
      </div>
    </div>
  );
}
