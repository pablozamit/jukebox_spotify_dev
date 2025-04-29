/**
 * Represents a song with relevant information from Spotify.
 */
export interface Song {
  /**
   * The Spotify ID of the track.
   */
  spotifyTrackId: string;
  /**
   * The title of the song.
   */
  title: string;
  /**
   * The artist of the song.
   */
  artist: string;
  /**
   * Optional: URL of the album art.
   */
  albumArtUrl?: string;
}

/**
 * Represents the configuration for searching songs on Spotify.
 */
export interface SpotifyConfig {
  /**
   * The search mode, either 'all' to search all of Spotify or 'playlist' to search a specific playlist.
   */
  searchMode: 'all' | 'playlist';
  /**
   * The ID of the Spotify playlist to search, if searchMode is 'playlist'. Required if searchMode is 'playlist'.
   */
  playlistId?: string;
    /**
   * Indicates if Spotify connection (OAuth) is active.
   */
  spotifyConnected: boolean;
}

/**
 * Asynchronously searches for songs on Spotify based on the provided search term and configuration.
 * This function is a STUB and needs actual Spotify API implementation.
 * @param searchTerm The term to search for.
 * @param config The Spotify search configuration, potentially fetched from Firebase.
 * @returns A promise that resolves to an array of Song objects matching the search criteria.
 */
export async function searchSpotify(
  searchTerm: string,
  config: SpotifyConfig | null // Config might be null if Firebase read fails
): Promise<Song[]> {
    // Default to 'all' search if config is missing or invalid
    const mode = config?.searchMode ?? 'all';
    const playlistId = config?.playlistId;

    console.log(`Searching Spotify (mode: ${mode}) for: "${searchTerm}" ${mode === 'playlist' ? `in playlist ${playlistId || 'undefined'}` : ''}`);

    if (!searchTerm.trim()) {
        return [];
    }

    // STUBBED RESPONSE - Replace with actual API call
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));

    if (searchTerm.toLowerCase().includes('error')) {
        console.error("Simulated search error triggered.");
        throw new Error("Simulated search error");
    }

    // Example stubbed data
    const allSpotifyResults: Song[] = [
        { spotifyTrackId: '4uLU6hMCjMI75M1A2tKUQC', title: 'Bohemian Rhapsody', artist: 'Queen', albumArtUrl: 'https://i.scdn.co/image/ab67616d0000b2736a0a59f439e0a781f4d80d9d' },
        { spotifyTrackId: '5CQ30WqJwcep0pYcV4AMNc', title: 'Stairway to Heaven', artist: 'Led Zeppelin', albumArtUrl: 'https://i.scdn.co/image/ab67616d0000b273b5b6e9f4a3f5d3b5f5e6a5b1' },
        { spotifyTrackId: '7tFiyTwD0nx5a1eklYtX2J', title: 'Hotel California', artist: 'Eagles', albumArtUrl: 'https://i.scdn.co/image/ab67616d0000b273f1d5b9f7b4f7b4f7f4b7b4f7' },
        { spotifyTrackId: '3ZF4hf40j39YIZaL4SPCxu', title: 'Like a Rolling Stone', artist: 'Bob Dylan', albumArtUrl: 'https://i.scdn.co/image/ab67616d0000b273f9b1a5a9b8a9a5a9a5a9a5a9' },
        { spotifyTrackId: '1AJcUdEMsQ69TT7A43eLza', title: 'Smells Like Teen Spirit', artist: 'Nirvana', albumArtUrl: 'https://i.scdn.co/image/ab67616d0000b2730f7f7f7f7f7f7f7f7f7f7f7f' },
        { spotifyTrackId: 'stubbplaylist1', title: 'Playlist Song One', artist: 'Playlist Artist A', albumArtUrl: 'https://picsum.photos/seed/p1/64/64' },
        { spotifyTrackId: 'stubbplaylist2', title: 'Playlist Song Two (Searchable)', artist: 'Playlist Artist B', albumArtUrl: 'https://picsum.photos/seed/p2/64/64' },
    ];

    let results: Song[];

    if (mode === 'playlist') {
        if (!playlistId) {
            console.warn("Search mode is 'playlist', but no playlistId provided in config.");
            // Optionally throw error or return empty array, here returning empty for stub
             // return [];
             // For stub, let's pretend we fallback to all results if playlist ID missing
             console.warn("Falling back to searching all Spotify (stub behavior).");
             results = allSpotifyResults;
        } else {
            console.log(`Stub: Pretending to fetch from playlist ID: ${playlistId}`);
            // Filter the stub results to simulate playlist content
            results = allSpotifyResults.filter(s => s.spotifyTrackId.startsWith('stubbplaylist'));
        }
    } else {
        // 'all' mode
        results = allSpotifyResults;
    }

    // Filter results based on search term
    return results.filter(song =>
        song.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        song.artist.toLowerCase().includes(searchTerm.toLowerCase())
    );
}

/**
 * Represents the OAuth tokens for authenticating with the Spotify API.
 */
export interface SpotifyTokens {
  /**
   * The access token used to make requests to the Spotify API.
   */
  accessToken: string;
  /**
   * The refresh token used to obtain a new access token when the current one expires.
   */
  refreshToken: string;
   /**
    * Timestamp when the access token expires (in milliseconds since epoch).
    */
   expiresAt: number;
}

/**
 * Asynchronously retrieves the Spotify OAuth tokens.
 * This function is a STUB. It should securely retrieve tokens stored for the bar owner,
 * possibly from Firestore or a secure backend endpoint, associated with the logged-in admin user.
 * DO NOT hardcode tokens or store unencrypted in Realtime DB in production.
 * @returns A promise that resolves to a SpotifyTokens object or null if no tokens found/error.
 */
export async function getSpotifyTokens(): Promise<SpotifyTokens | null> {
  console.warn("getSpotifyTokens is a STUB. Implement secure token retrieval (e.g., from Firestore or secure backend).");
  // STUBBED RESPONSE - Replace with actual secure retrieval logic
  // Simulate fetching - in reality this might involve checking auth state, querying DB etc.
  await new Promise(resolve => setTimeout(resolve, 150));

  // Simulate scenario where tokens might not be available (user not connected)
   const shouldSimulateTokensExist = true; // Math.random() > 0.2; // Simulate 80% chance tokens exist

   if (shouldSimulateTokensExist) {
       return {
         accessToken: 'stubbed_access_token_123',
         refreshToken: 'stubbed_refresh_token_456',
         expiresAt: Date.now() + 3600 * 1000, // Expires in 1 hour (Spotify standard)
       };
   } else {
       console.log("Stub: Simulating no Spotify tokens found.");
       return null;
   }
}

/**
 * Asynchronously refreshes the Spotify access token using the refresh token.
 * This function is a STUB and needs actual Spotify API implementation.
 * It should make a POST request to Spotify's token endpoint and securely update the stored tokens.
 * @param refreshToken The refresh token to use.
 * @returns A promise that resolves to a new SpotifyTokens object or null if refresh fails.
 */
export async function refreshSpotifyToken(refreshToken: string): Promise<SpotifyTokens | null> {
  console.warn("refreshSpotifyToken is a STUB. Implement actual token refresh via Spotify API (POST /api/token) and secure storage update.");
  // STUBBED RESPONSE - Replace with actual API call and storage update

   // Simulate network delay for the refresh call
  await new Promise(resolve => setTimeout(resolve, 400));

   // Simulate success case
   const newAccessToken = `new_stubbed_access_token_${Date.now()}`;
   const newExpiresAt = Date.now() + 3600 * 1000;

   console.log(`Stub: Refreshed token. New Access Token: ${newAccessToken.substring(0,15)}...`);

   const refreshedTokens: SpotifyTokens = {
    accessToken: newAccessToken,
    refreshToken: refreshToken, // Often stays the same, but API might return a new one
    expiresAt: newExpiresAt,
   };

   // !! IMPORTANT !! In a real implementation, you MUST securely save these new tokens here.
   // e.g., update the Firestore document for the admin user.
   // await saveRefreshedTokens(refreshedTokens);
   console.log("Stub: (Not) Saving refreshed tokens securely.");


   return refreshedTokens;

   // Simulate failure case (optional)
   // console.error("Stub: Simulating token refresh failure.");
   // return null;
}

/**
 * Asynchronously adds a song to the Spotify playback queue.
 * Requires a *valid* access token with the `user-modify-playback-state` scope.
 * This function is a STUB and needs actual Spotify API implementation.
 * @param spotifyTrackId The Spotify ID of the track to add (e.g., '4uLU6hMCjMI75M1A2tKUQC').
 * @param accessToken A valid Spotify access token.
 * @returns A promise that resolves when the song has been successfully added or rejects on error.
 */
export async function addSongToSpotifyPlaybackQueue(spotifyTrackId: string, accessToken: string): Promise<void> {
  console.log(`Attempting to add song ${spotifyTrackId} to Spotify queue using token starting with ${accessToken.substring(0, 10)}...`);

  // --- STUBBED IMPLEMENTATION ---
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 400));

   // Simulate potential API errors based on track ID for testing
   if (spotifyTrackId === 'error_track_id_not_found') {
     console.error(`Stub Error: Track ${spotifyTrackId} not found (simulated).`);
     throw new Error("Simulated 404 Not Found");
   }
    if (spotifyTrackId === 'error_track_id_no_device') {
        console.error(`Stub Error: No active Spotify device found (simulated).`);
        throw new Error("Simulated No Active Device");
    }
     if (spotifyTrackId === 'error_track_id_auth') {
         console.error(`Stub Error: Invalid access token (simulated).`);
         throw new Error("Simulated Invalid Token");
     }


  // --- Real Implementation Placeholder ---
  /*
  const spotifyApiEndpoint = `https://api.spotify.com/v1/me/player/queue?uri=spotify:track:${spotifyTrackId}`;

  try {
    const response = await fetch(spotifyApiEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Length': '0' // Some APIs require Content-Length even for empty body POSTs
      },
    });

    if (!response.ok) {
      let errorBody;
      try {
          errorBody = await response.json();
      } catch (e) {
          errorBody = { message: 'Failed to parse error response', status: response.status };
      }
      console.error("Spotify API Error:", response.status, errorBody);

      // Specific error handling based on status code
      if (response.status === 401) { // Unauthorized - Token likely expired or invalid scopes
          throw new Error("Spotify authorization failed. Token may be invalid or expired.");
      } else if (response.status === 404) { // Not Found - Device offline or track doesn't exist?
          throw new Error(errorBody.error?.reason === 'NO_ACTIVE_DEVICE' ? "No active Spotify device found." : "Spotify resource not found (device or track).");
      } else if (response.status === 403) { // Forbidden - Insufficient scope or other permission issue
           throw new Error("Permission denied by Spotify. Check API scopes or playback restrictions.");
      }
      // Generic error for other cases
      throw new Error(`Failed to add song to Spotify queue: ${response.statusText} (Status: ${response.status})`);
    }

    console.log(`Successfully added song ${spotifyTrackId} to Spotify queue via API.`);

  } catch (error) {
      // Handle network errors or errors thrown from response checking
      console.error("Network or processing error when adding to Spotify queue:", error);
      throw error; // Re-throw the error to be caught by the caller
  }
  */
  // --- End Real Implementation Placeholder ---


  console.log(`STUB: Successfully added song ${spotifyTrackId} to Spotify queue.`);
}


// --- Helper function to manage token refresh ---

// Simple in-memory cache for STUBBED tokens. In production, avoid global mutable state like this.
let cachedTokens: SpotifyTokens | null = null;
let isRefreshing = false; // Prevent concurrent refresh attempts

/**
 * Gets a valid access token, attempting to refresh if necessary.
 * This is a STUB and relies on other stubbed functions. Replace with robust implementation.
 * Handles basic caching and prevents concurrent refreshes.
 * @returns A promise resolving to a valid access token, or null if fetching/refreshing fails.
 */
async function getValidAccessToken(): Promise<string | null> {
    // If currently refreshing, wait briefly and retry (simple mechanism)
    while (isRefreshing) {
        console.log("Waiting for ongoing token refresh...");
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    try {
        if (!cachedTokens) {
            console.log("No cached tokens, fetching initial tokens...");
            cachedTokens = await getSpotifyTokens(); // Initial fetch (stubbed)
            if (!cachedTokens) {
                console.error("Failed to fetch initial Spotify tokens.");
                return null;
            }
            console.log("Initial tokens fetched.");
        }

        // Check if token is expired or close to expiring (e.g., within 60 seconds)
        const bufferSeconds = 60;
        if (Date.now() >= cachedTokens.expiresAt - bufferSeconds * 1000) {
            console.log("Spotify token expired or nearing expiry, attempting refresh...");
            isRefreshing = true;
            const refreshed = await refreshSpotifyToken(cachedTokens.refreshToken); // Refresh (stubbed)
            if (refreshed) {
                cachedTokens = refreshed; // Update cache with new tokens
                console.log("Token refresh successful.");
            } else {
                console.error("Spotify token refresh failed.");
                cachedTokens = null; // Invalidate cache on failed refresh
                return null; // Indicate failure
            }
        }

        return cachedTokens.accessToken;

    } catch (error) {
        console.error("Error during token retrieval/refresh:", error);
        cachedTokens = null; // Invalidate cache on error
        return null;
    } finally {
        isRefreshing = false; // Ensure flag is reset
    }
}

/**
 * Wrapper function for adding a song to the Spotify queue.
 * Automatically handles fetching and refreshing the access token.
 * Use this function from your UI/backend logic (e.g., AdminPage).
 * @param spotifyTrackId The Spotify ID of the track to add.
 * @returns A promise that resolves on success or rejects on failure (e.g., cannot get token, API error).
 */
export async function addSongToQueueWithAutoToken(spotifyTrackId: string): Promise<void> {
    console.log(`Attempting to add ${spotifyTrackId} with auto token handling...`);
    try {
        const accessToken = await getValidAccessToken(); // Handles refresh internally (stubbed)

        if (!accessToken) {
            console.error("Could not obtain valid Spotify access token.");
            throw new Error("Failed to get Spotify access token. Is Spotify connected?");
        }

        // Now call the actual API function with the obtained token
        await addSongToSpotifyPlaybackQueue(spotifyTrackId, accessToken);

        console.log(`Successfully added ${spotifyTrackId} using auto token.`);

    } catch (error) {
        console.error("Error adding song with auto token management:", error);
        // Rethrow the error so the caller (e.g., AdminPage) can display feedback
        throw error;
    }
}
