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
import { auth, db } from '@/lib/firebase'; // Import centralized Firebase instances
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
    if (!auth || !db) {
      setFirebaseError("Firebase is not configured correctly. Admin panel functionality may be limited.");
      setLoadingAuth(false);
      setIsLoadingQueue(false);
      setIsLoadingConfig(false);
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
    if (!user || !db) { // Don't fetch if not logged in or db unavailable
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
            const songData = data[key];
            loadedQueue.push({
                id: key,
                ...songData,
                timestampAdded: typeof songData.timestampAdded === 'number' ? songData.timestampAdded : (songData.order ?? 0) // Use order for sorting if timestamp is server value
            });
        });
        // Sort by order field primarily, then timestampAdded as fallback
        loadedQueue.sort((a, b) => (a.order ?? (a.timestampAdded as number)) - (b.order ?? (b.timestampAdded as number)));
      }
      setQueue(loadedQueue);
      setFirebaseError(null); // Clear error on success
      setIsLoadingQueue(false);
    }, (error) => {
      console.error("Firebase Queue Read Error:", error);
      setFirebaseError("Could not load queue. Check console.");
      toast({ title: "Error", description: "Could not load queue.", variant: "destructive" });
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
         }).catch(err => {
             console.error("Failed to set default config:", err);
             setFirebaseError("Failed to write default configuration.");
             toast({ title: "Error", description: "Could not save default configuration.", variant: "destructive" });
          });
       }
       setIsLoadingConfig(false);
       setFirebaseError(null); // Clear error on success
     }, (error) => {
       console.error("Firebase Config Read Error:", error);
       setFirebaseError("Could not load configuration. Check console.");
       toast({ title: "Error", description: "Could not load configuration.", variant: "destructive" });
       setIsLoadingConfig(false);
     });
     return () => unsubscribe();
   }, [user, toast]); // Removed db dependency

  const handleLogout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      router.push('/admin/login');
    } catch (error) {
      console.error("Logout Error:", error);
      toast({ title: "Logout Error", description: "Could not log out.", variant: "destructive" });
    }
  };

  const handleRemoveSong = async (songId: string, addedByUserId?: string) => {
     if (!db) return;
    const songRef = ref(db, `queue/${songId}`);
    try {
      await remove(songRef);
      toast({ title: "Song Removed", description: "Successfully removed from queue." });

      // --- Attempt to reset user's canAddSong status ---
      // This is a simplified approach. A robust solution might involve
      // Cloud Functions triggered on queue removal or tracking played songs.
      // This requires the 'addedByUserId' to be stored correctly when the song is added.
       if (addedByUserId) {
            console.log(`Song added by ${addedByUserId} removed. Ideally, reset their status.`);
            // If we had a '/userStatus/{userId}/canAddSong' node, we could set it to true here.
            // const userStatusRef = ref(db, `userStatus/${addedByUserId}/canAddSong`);
            // await set(userStatusRef, true);
            // For now, this relies on the client-side check refreshing.
       }
      // --- End user status reset attempt ---

    } catch (error) {
      console.error("Firebase Remove Error:", error);
      toast({ title: "Error", description: "Could not remove song.", variant: "destructive" });
    }
  };

  // --- Reordering Logic (Assign explicit order numbers) ---
  const handleMove = async (index: number, direction: 'up' | 'down') => {
      if (!db) return;
      const newQueue = [...queue];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;

      if (targetIndex < 0 || targetIndex >= newQueue.length) {
          return; // Cannot move outside bounds
      }

      // Swap items positionally first for immediate UI feedback (optional)
      // [newQueue[index], newQueue[targetIndex]] = [newQueue[targetIndex], newQueue[index]];
      // setQueue(newQueue); // Optimistic update (can be removed if relying solely on onValue)

      // Assign new 'order' values based on swapped position.
      // Using timestamps ensures relatively stable ordering even with concurrent adds/removes.
      const updates: { [key: string]: any } = {};
      const timestampBase = Date.now(); // Use a consistent base for this batch

      // Simple swap: assign order based on target's original timestamp +/- epsilon
      const movingSong = newQueue[index];
      const targetSong = newQueue[targetIndex];

      // Temporarily give them orders that reflect the swap intention
      const order1 = (targetSong.order ?? (targetSong.timestampAdded as number));
      const order2 = (movingSong.order ?? (movingSong.timestampAdded as number));


      updates[`/queue/${movingSong.id}/order`] = order1;
      updates[`/queue/${targetSong.id}/order`] = order2;


      // // More robust: Re-assign order to all items based on new array index
      // newQueue.forEach((song, i) => {
      //     // A simple approach: use index * factor + base_timestamp
      //     // Adjust factor as needed based on expected queue size and frequency
      //     updates[`/queue/${song.id}/order`] = timestampBase + i * 1000;
      // });


      try {
          await update(ref(db), updates);
          toast({ title: "Queue Reordered", description: "Song position updated." });
          // onValue listener will handle the final state update from Firebase
      } catch (error) {
          console.error("Firebase Reorder Error:", error);
          toast({ title: "Error", description: "Could not reorder queue.", variant: "destructive" });
          // Optionally revert optimistic update here if it was used
      }
  };
  // --- End Reordering Logic ---

  const handleConfigChange = async (updates: Partial<AdminConfig>) => {
      if (!db || !config) return; // Need db and existing config to update
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
    if (!db) return; // Need db to update connection status
    // TODO: Implement initiation of Spotify OAuth flow
    // This would typically involve redirecting the user to a Cloud Function endpoint
    // e.g., GET /api/spotify/login which then redirects to Spotify's auth page.
    toast({ title: "Connect Spotify", description: "OAuth flow initiation not yet implemented.", variant: "default" });
    console.log("Initiate Spotify OAuth flow here...");

     // --- Mock connection state change ---
     handleConfigChange({ spotifyConnected: !config?.spotifyConnected });
     // --- End Mock ---
  };

  // Add next song to Spotify Queue using the wrapper function
  const handleAddNextToSpotify = async () => {
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

      // IMPORTANT: Remove the song from *our* queue *after* successfully adding to Spotify
      // Pass the user ID if available to attempt resetting their status
      await handleRemoveSong(nextSong.id, nextSong.addedByUserId);

    } catch (error) {
      console.error("Spotify Add Queue Error:", error);
      toast({ title: "Spotify Error", description: `Could not add song to Spotify queue. Error: ${error instanceof Error ? error.message : 'Unknown error'}`, variant: "destructive" });
    }
  };


   // Display Firebase Error if present
   if (firebaseError && !isLoadingQueue && !isLoadingConfig) { // Show error only if not loading
       return (
           <div className="container mx-auto p-4 flex justify-center items-center min-h-screen">
                <Card className="w-full max-w-lg shadow-lg border border-destructive">
                   <CardHeader>
                       <CardTitle className="text-destructive flex items-center gap-2">
                           <AlertTriangle className="h-6 w-6" /> Runtime Error
                       </CardTitle>
                        <CardDescription>There was an issue connecting to Firebase.</CardDescription>
                   </CardHeader>
                   <CardContent>
                       <p className="text-destructive-foreground">{firebaseError}</p>
                       <p className="text-sm text-muted-foreground mt-2">Please check the browser console for more details and verify your Firebase project configuration (.env file).</p>
                   </CardContent>
                   <CardFooter>
                       <Button variant="outline" onClick={() => window.location.reload()}>Reload Page</Button>
                        {auth && <Button onClick={handleLogout} variant="destructive" className="ml-auto">
                           <LogOut className="mr-2 h-4 w-4" /> Logout
                        </Button>}
                   </CardFooter>
               </Card>
           </div>
       );
   }


  if (loadingAuth || !user) {
    // Show loading spinner only if Firebase connection is okay
    return (
      <div className="flex justify-center items-center min-h-screen">
        {!firebaseError && <RefreshCw className="h-8 w-8 animate-spin text-primary" />}
        {/* If firebaseError is set, the error card above should be shown instead */}
      </div>
    );
  }

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
                disabled={queue.length === 0 || !config?.spotifyConnected || !db} // Also disable if db error
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
                      <Skeleton className="h-5 w-5 rounded-full" />
                      {/* <Skeleton className="h-8 w-8 rounded-full" /> */}
                       <Skeleton className="h-6 w-6 rounded-md" />
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
                       <span className="text-lg font-medium text-primary w-6 text-center">{index + 1}</span>
                      <Music className="h-5 w-5 text-accent flex-shrink-0" />
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
                           disabled={index === 0 || !db}
                           aria-label="Move song up"
                           className="text-muted-foreground hover:text-primary disabled:opacity-30"
                         >
                           <ArrowUp className="h-4 w-4" />
                         </Button>
                         <Button
                           variant="ghost"
                           size="icon"
                           onClick={() => handleMove(index, 'down')}
                           disabled={index === queue.length - 1 || !db}
                           aria-label="Move song down"
                           className="text-muted-foreground hover:text-primary disabled:opacity-30"
                         >
                           <ArrowDown className="h-4 w-4" />
                         </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveSong(song.id, song.addedByUserId)}
                          disabled={!db}
                          aria-label="Remove song"
                          className="text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-center text-muted-foreground py-10">Queue is empty.</p>
              )}
            </ScrollArea>
          </CardContent>
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
             {isLoadingConfig || config === null ? ( // Show skeleton if loading or config is null
                <div className="space-y-4">
                    <Skeleton className="h-8 w-full rounded-md" />
                    <Skeleton className="h-10 w-full rounded-md" />
                    <Skeleton className="h-10 w-full rounded-md" />
                </div>
             ) : (
                <>
                 {/* Spotify Connection */}
                 <div className="flex items-center justify-between">
                   <Label htmlFor="spotify-connect" className="flex items-center gap-2">
                    {config.spotifyConnected ? <Wifi className="text-green-500"/> : <WifiOff className="text-destructive"/>}
                     Spotify Status
                   </Label>
                   <Button id="spotify-connect" onClick={handleSpotifyConnect} size="sm" variant={config.spotifyConnected ? "destructive" : "default"} disabled={!db}>
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
                     disabled={!db}
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
                         disabled={config.searchMode !== 'playlist' || !db}
                         className="flex-grow"
                       />
                       <Button onClick={handlePlaylistIdSave} size="sm" disabled={config.searchMode !== 'playlist' || !playlistIdInput.trim() || !db}>Save</Button>
                     </div>
                   </div>
                 )}
               </>
             )}
           </CardContent>
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
