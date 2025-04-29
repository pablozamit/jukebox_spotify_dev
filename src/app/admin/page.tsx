'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation'; // Use next/navigation for App Router
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { Song } from '@/services/spotify';
import { Trash2, ArrowUp, ArrowDown, Settings, LogOut, Music, ListMusic, RefreshCw, WifiOff, Wifi } from 'lucide-react';
import { getAuth, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { getDatabase, ref, onValue, remove, set, update, serverTimestamp, push } from 'firebase/database'; // Add 'update', 'serverTimestamp'
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { addSongToSpotifyPlaybackQueue } from '@/services/spotify'; // Import the function

// TODO: Replace with your actual Firebase config
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let firebaseApp: FirebaseApp;
if (!getApps().length) {
  firebaseApp = initializeApp(firebaseConfig);
} else {
  firebaseApp = getApps()[0];
}
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);

interface QueueSong extends Song {
  id: string; // Firebase key
  timestampAdded: number;
  order?: number; // For potential reordering
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
  const [config, setConfig] = useState<AdminConfig>({ searchMode: 'all', spotifyConnected: false });
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [playlistIdInput, setPlaylistIdInput] = useState('');
  const router = useRouter();
  const { toast } = useToast();

  // Authentication Check
  useEffect(() => {
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
  }, [router]);

  // Fetch Queue
  useEffect(() => {
    if (!user) return; // Don't fetch if not logged in

    const queueRef = ref(db, 'queue');
    setIsLoadingQueue(true);
    const unsubscribe = onValue(queueRef, (snapshot) => {
      const data = snapshot.val();
      const loadedQueue: QueueSong[] = [];
      if (data) {
        Object.keys(data).forEach(key => {
          loadedQueue.push({ id: key, ...data[key] });
        });
        // Sort by timestampAdded or a dedicated order field if implemented
        loadedQueue.sort((a, b) => (a.order ?? a.timestampAdded) - (b.order ?? b.timestampAdded));
      }
      setQueue(loadedQueue);
      setIsLoadingQueue(false);
    }, (error) => {
      console.error("Firebase Queue Read Error:", error);
      toast({ title: "Error", description: "Could not load queue.", variant: "destructive" });
      setIsLoadingQueue(false);
    });
    return () => unsubscribe();
  }, [user, db, toast]);

  // Fetch Config
   useEffect(() => {
     if (!user) return;

     const configRef = ref(db, 'config');
     setIsLoadingConfig(true);
     const unsubscribe = onValue(configRef, (snapshot) => {
       const data = snapshot.val();
       if (data) {
         setConfig(data);
         setPlaylistIdInput(data.playlistId || ''); // Initialize input field
       } else {
         // Set default config if none exists
         const defaultConfig: AdminConfig = { searchMode: 'all', spotifyConnected: false };
         set(configRef, defaultConfig).catch(err => console.error("Failed to set default config:", err));
         setConfig(defaultConfig);
         setPlaylistIdInput('');
       }
       setIsLoadingConfig(false);
     }, (error) => {
       console.error("Firebase Config Read Error:", error);
       toast({ title: "Error", description: "Could not load configuration.", variant: "destructive" });
       setIsLoadingConfig(false);
     });
     return () => unsubscribe();
   }, [user, db, toast]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.push('/admin/login');
    } catch (error) {
      console.error("Logout Error:", error);
      toast({ title: "Logout Error", description: "Could not log out.", variant: "destructive" });
    }
  };

  const handleRemoveSong = async (songId: string) => {
    const songRef = ref(db, `queue/${songId}`);
    try {
      await remove(songRef);
      toast({ title: "Song Removed", description: "Successfully removed from queue." });
      // Fetching the removed song's user ID requires a different structure or logic
      // For now, we can't easily reset 'canAddSong' for the specific user here.
      // A more complex solution would involve tracking played songs or using Cloud Functions.
    } catch (error) {
      console.error("Firebase Remove Error:", error);
      toast({ title: "Error", description: "Could not remove song.", variant: "destructive" });
    }
  };

  // --- Reordering Logic (Simplified: Swap with adjacent) ---
  const handleMove = async (index: number, direction: 'up' | 'down') => {
      const newQueue = [...queue];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;

      if (targetIndex < 0 || targetIndex >= newQueue.length) {
          return; // Cannot move outside bounds
      }

      // Swap items
      [newQueue[index], newQueue[targetIndex]] = [newQueue[targetIndex], newQueue[index]];

      // Create updates object for Firebase atomic update
      const updates: { [key: string]: any } = {};
      newQueue.forEach((song, i) => {
          // Assign a simple order based on the new array index
          // Using timestamp as a base ensures uniqueness and roughly maintains original order on ties
          updates[`/queue/${song.id}/order`] = song.timestampAdded + i * 1000; // Simple ordering offset
      });

      try {
          await update(ref(db), updates);
          toast({ title: "Queue Reordered", description: "Song position updated." });
          // No need to manually setQueue, onValue listener will update it
      } catch (error) {
          console.error("Firebase Reorder Error:", error);
          toast({ title: "Error", description: "Could not reorder queue.", variant: "destructive" });
      }
  };
  // --- End Reordering Logic ---

  const handleConfigChange = async (updates: Partial<AdminConfig>) => {
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
    if (config.searchMode === 'playlist') {
      handleConfigChange({ playlistId: playlistIdInput.trim() });
    }
  };

  // Placeholder for Spotify OAuth flow
  const handleSpotifyConnect = () => {
    // TODO: Implement initiation of Spotify OAuth flow
    // This would typically involve redirecting the user to a Cloud Function endpoint
    // e.g., GET /spotifyOAuthLogin which then redirects to Spotify's auth page.
    toast({ title: "Connect Spotify", description: "OAuth flow initiation not yet implemented.", variant: "default" });

     // --- Mock connection state change ---
     handleConfigChange({ spotifyConnected: !config.spotifyConnected });
     // --- End Mock ---
  };

  // Placeholder for adding next song to Spotify Queue
  const handleAddNextToSpotify = async () => {
    if (!config.spotifyConnected) {
      toast({ title: "Not Connected", description: "Connect to Spotify first.", variant: "destructive" });
      return;
    }
    if (queue.length === 0) {
      toast({ title: "Queue Empty", description: "No songs to add.", variant: "default" });
      return;
    }

    const nextSong = queue[0];
    try {
      // Call the (stubbed) service function
      await addSongToSpotifyPlaybackQueue(nextSong.spotifyTrackId);
      toast({ title: "Song Queued on Spotify", description: `${nextSong.title} added to Spotify playback.` });

      // Optionally remove the song from Firebase queue after adding to Spotify
      // await handleRemoveSong(nextSong.id);
      // Be cautious with auto-removal, consider edge cases (Spotify queue full, etc.)

    } catch (error) {
      console.error("Spotify Add Queue Error:", error);
      toast({ title: "Spotify Error", description: "Could not add song to Spotify queue.", variant: "destructive" });
    }
  };


  if (loadingAuth || !user) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
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
                disabled={queue.length === 0 || !config.spotifyConnected}
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
                      <Skeleton className="h-8 w-8 rounded-full" />
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
                      </div>
                      <div className="flex gap-1 ml-auto">
                         <Button
                           variant="ghost"
                           size="icon"
                           onClick={() => handleMove(index, 'up')}
                           disabled={index === 0}
                           aria-label="Move song up"
                           className="text-muted-foreground hover:text-primary disabled:opacity-30"
                         >
                           <ArrowUp className="h-4 w-4" />
                         </Button>
                         <Button
                           variant="ghost"
                           size="icon"
                           onClick={() => handleMove(index, 'down')}
                           disabled={index === queue.length - 1}
                           aria-label="Move song down"
                           className="text-muted-foreground hover:text-primary disabled:opacity-30"
                         >
                           <ArrowDown className="h-4 w-4" />
                         </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveSong(song.id)}
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
             {isLoadingConfig ? (
                <Skeleton className="h-24 w-full rounded-md" />
             ) : (
                <>
                 {/* Spotify Connection */}
                 <div className="flex items-center justify-between">
                   <Label htmlFor="spotify-connect" className="flex items-center gap-2">
                    {config.spotifyConnected ? <Wifi className="text-green-500"/> : <WifiOff className="text-destructive"/>}
                     Spotify Status
                   </Label>
                   <Button id="spotify-connect" onClick={handleSpotifyConnect} size="sm" variant={config.spotifyConnected ? "destructive" : "default"}>
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
                         disabled={config.searchMode !== 'playlist'}
                         className="flex-grow"
                       />
                       <Button onClick={handlePlaylistIdSave} size="sm" disabled={config.searchMode !== 'playlist'}>Save</Button>
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
             <Button onClick={handleLogout} variant="outline" className="w-full">
               <LogOut className="mr-2 h-4 w-4" /> Logout
             </Button>
           </CardContent>
         </Card>
      </div>
    </div>
  );
}
