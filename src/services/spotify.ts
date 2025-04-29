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
   * The ID of the Spotify playlist to search, if searchMode is 'playlist'.
   */
  playlistId?: string;
}

/**
 * Asynchronously searches for songs on Spotify based on the provided search term and configuration.
 * This function is a STUB and needs actual Spotify API implementation.
 * @param searchTerm The term to search for.
 * @param config The Spotify search configuration.
 * @returns A promise that resolves to an array of Song objects matching the search criteria.
 */
export async function searchSpotify(
  searchTerm: string,
  config: SpotifyConfig
): Promise<Song[]> {
  console.log(`Searching Spotify (mode: ${config.searchMode}) for: "${searchTerm}" ${config.searchMode === 'playlist' ? `in playlist ${config.playlistId}` : ''}`);

  // STUBBED RESPONSE - Replace with actual API call
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));

  if (searchTerm.toLowerCase().includes('error')) {
       throw new Error("Simulated search error");
   }

  if (!searchTerm.trim()) {
    return [];
  }

  // Example stubbed data - structure matches the Song interface
  const stubResults: Song[] = [
    { spotifyTrackId: '4uLU6hMCjMI75M1A2tKUQC', title: 'Bohemian Rhapsody', artist: 'Queen', albumArtUrl: 'https://i.scdn.co/image/ab67616d0000b273e3b3e0b3b0b3b0b3b0b3b0b3' },
    { spotifyTrackId: '5CQ30WqJwcep0pYcV4AMNc', title: 'Stairway to Heaven', artist: 'Led Zeppelin', albumArtUrl: 'https://i.scdn.co/image/ab67616d0000b273b3b3e0b3b0b3b0b3b0b3b0b4' },
    { spotifyTrackId: '7tFiyTwD0nx5a1eklYtX2J', title: 'Hotel California', artist: 'Eagles', albumArtUrl: 'https://i.scdn.co/image/ab67616d0000b273b3b3e0b3b0b3b0b3b0b3b0b5' },
    { spotifyTrackId: '3ZF4hf40j39YIZaL4SPCxu', title: 'Like a Rolling Stone', artist: 'Bob Dylan', albumArtUrl: 'https://i.scdn.co/image/ab67616d0000b273b3b3e0b3b0b3b0b3b0b3b0b6' },
    { spotifyTrackId: '1AJcUdEMsQ69TT7A43eLza', title: 'Smells Like Teen Spirit', artist: 'Nirvana', albumArtUrl: 'https://i.scdn.co/image/ab67616d0000b273b3b3e0b3b0b3b0b3b0b3b0b7' },
  ];

  // Filter stub results based on search term for a slightly more realistic stub
  return stubResults.filter(song =>
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
 * This function is a STUB. It should securely retrieve tokens, likely stored per-user (bar owner)
 * in a secure location like Firestore with strict security rules, NOT hardcoded or in Realtime DB directly for production.
 * @returns A promise that resolves to a SpotifyTokens object containing the access and refresh tokens.
 */
export async function getSpotifyTokens(): Promise<SpotifyTokens> {
  console.warn("getSpotifyTokens is a STUB. Implement secure token retrieval.");
  // STUBBED RESPONSE - Replace with actual secure retrieval
  return {
    accessToken: 'stubbed_access_token_123',
    refreshToken: 'stubbed_refresh_token_456',
    expiresAt: Date.now() + 3600 * 1000, // Expires in 1 hour (Spotify standard)
  };
}

/**
 * Asynchronously refreshes the Spotify access token using the refresh token.
 * This function is a STUB and needs actual Spotify API implementation.
 * It should also securely update the stored tokens.
 * @param refreshToken The refresh token to use.
 * @returns A promise that resolves to a new SpotifyTokens object.
 */
export async function refreshSpotifyToken(refreshToken: string): Promise<SpotifyTokens> {
  console.warn("refreshSpotifyToken is a STUB. Implement actual token refresh via Spotify API and secure storage update.");
  // STUBBED RESPONSE - Replace with actual API call and storage update
  await new Promise(resolve => setTimeout(resolve, 300)); // Simulate network delay
  return {
    accessToken: `new_stubbed_access_token_${Date.now()}`,
    refreshToken: refreshToken, // Usually the refresh token remains the same, but Spotify might issue a new one
    expiresAt: Date.now() + 3600 * 1000,
  };
}

/**
 * Asynchronously adds a song to the Spotify playback queue.
 * This function is a STUB and needs actual Spotify API implementation using valid OAuth tokens.
 * @param spotifyTrackId The Spotify ID of the track to add.
 * @param accessToken A valid Spotify access token with the necessary scopes (e.g., user-modify-playback-state).
 * @returns A promise that resolves when the song has been successfully added to the queue.
 */
export async function addSongToSpotifyPlaybackQueue(spotifyTrackId: string, accessToken: string): Promise<void> {
  console.log(`STUB: Adding song with ID ${spotifyTrackId} to the Spotify queue using token ${accessToken.substring(0, 10)}...`);

  // STUBBED IMPLEMENTATION - Replace with actual API call
  // Example using fetch (adjust endpoint and headers as needed):
  /*
  const response = await fetch(`https://api.spotify.com/v1/me/player/queue?uri=spotify:track:${spotifyTrackId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    // Handle errors (e.g., no active device, invalid token, track not found)
    const errorBody = await response.json();
    console.error("Spotify API Error:", errorBody);
    throw new Error(`Failed to add song to Spotify queue: ${response.statusText}`);
  }
  console.log(`Successfully added song ${spotifyTrackId} to Spotify queue.`);
  */

  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 400));

   // Simulate potential error
   if (spotifyTrackId === 'error_track_id') {
     throw new Error("Simulated error adding song to Spotify queue");
   }

  console.log(`STUB: Successfully added song ${spotifyTrackId} to Spotify queue.`);
}

// --- Helper function to manage token refresh ---

let cachedTokens: SpotifyTokens | null = null; // Simple in-memory cache for STUB

/**
 * Gets a valid access token, refreshing if necessary.
 * This is a STUB and relies on other stubbed functions. Replace with robust implementation.
 */
async function getValidAccessToken(): Promise<string> {
    if (!cachedTokens) {
        cachedTokens = await getSpotifyTokens(); // Initial fetch (stubbed)
    }

    if (Date.now() >= cachedTokens.expiresAt - 60 * 1000) { // Refresh if expires within 60 seconds
        console.log("Refreshing Spotify token...");
        cachedTokens = await refreshSpotifyToken(cachedTokens.refreshToken); // Refresh (stubbed)
    }

    return cachedTokens.accessToken;
}

/**
 * Wrapper function for addSongToSpotifyPlaybackQueue that handles token retrieval/refresh.
 * Use this function from your UI/backend logic.
 * @param spotifyTrackId The Spotify ID of the track to add.
 */
export async function addSongToQueueWithAutoToken(spotifyTrackId: string): Promise<void> {
    try {
        const accessToken = await getValidAccessToken(); // Handles refresh internally (stubbed)
        await addSongToSpotifyPlaybackQueue(spotifyTrackId, accessToken); // Uses the valid token (stubbed)
    } catch (error) {
        console.error("Error adding song with auto token management:", error);
        // Rethrow or handle the error appropriately for the caller
        throw error;
    }
}
