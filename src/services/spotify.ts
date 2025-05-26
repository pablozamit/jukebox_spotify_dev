// src/services/spotify.ts

import axios from 'axios';
import { 
  getValidSpotifyAccessToken, 
  isElectron, 
  getApplicationSettings, // To get searchMode and playlistId
  searchSpotifyLocally // Import the actual function
} from '@/lib/electron-ipc'; 
import SpotifyWebApi from 'spotify-web-api-node';

// Placeholder invokeSearchSpotifyLocally removed as searchSpotifyLocally is now imported directly


export interface Song {
  spotifyTrackId: string;
  title: string;
  artist: string;
  albumArtUrl?: string | null;
}

// This interface might become less relevant here if settings are always fetched from Electron
export interface SpotifyConfig {
  searchMode: 'all' | 'playlist';
  playlistId?: string | null; // Updated to include null
  // spotifyConnected: boolean; // This is now implicitly handled by token availability
}

// This interface was used for the direct API call, might be less needed here
// interface SpotifyTrack {
//   id: string;
//   name: string;
//   artists: { name: string }[];
//   album: {
//     name: string;
//     images?: { url: string }[];
//   };
//   uri: string;
//   preview_url: string | null;
// }

// 🔍 Buscar canciones
export async function searchSpotify(
  searchTerm: string,
  // config: SpotifyConfig | null, // Config will be fetched from Electron if running there
  passedConfig: SpotifyConfig | null, // Keep for non-Electron path, or remove if non-Electron is fully deprecated
  offset: number = 0,
  limit: number = 20
): Promise<Song[]> {
  if (isElectron()) {
    console.log('searchSpotify: Running in Electron, using IPC.');
    // Fetch current app settings for searchMode and playlistId
    const settingsResult = await getApplicationSettings();
    if (!settingsResult.success || !settingsResult.settings) {
      throw new Error(settingsResult.error || 'Could not fetch app settings in Electron for search.');
    }
    
    const { searchMode, playlistId } = settingsResult.settings;

    const ipcResult = await searchSpotifyLocally({ // Use imported function
      searchTerm, 
      searchMode, 
      playlistId, 
      offset, 
      limit 
    });

    if (ipcResult.success && ipcResult.results) {
      return ipcResult.results;
    } else {
      throw new Error(ipcResult.error || 'Failed to search Spotify via Electron IPC.');
    }

  } else {
    // Fallback or error for non-Electron environments
    console.error('searchSpotify: Not in Electron environment. Search is only available in Electron.');
    throw new Error('Spotify search is only available within the Electron application.');
    // // The old fetch logic is removed as the API route will be deprecated.
    // const mode = passedConfig?.searchMode ?? 'all';
    // const pId = passedConfig?.playlistId;
    // const params = new URLSearchParams({ q: searchTerm, mode });
    // if (mode === 'playlist' && pId) {
    //   params.set('playlistId', pId);
    // }
    // params.set('offset', String(offset));
    // params.set('limit', String(limit));
    
    // console.log(`searchSpotify: Non-Electron mode, fetching /api/searchSpotify?${params.toString()}`);
    // const res = await fetch(`/api/searchSpotify?${params.toString()}`);
    // if (!res.ok) {
    //   const body = await res.json().catch(() => ({ error: 'Error desconocido al buscar en Spotify (non-Electron)' }));
    //   throw new Error(body.error || `Error ${res.status} buscando en Spotify (non-Electron)`);
    // }
    // const body = await res.json();
    // if (!body.results || !Array.isArray(body.results)) {
    //   console.warn("Spotify API (non-Electron) did not return expected 'results' array:", body);
    //   return [];
    // }
    // return body.results as Song[];
  }
}

/**
 * @deprecated La reproducción directa ya no se utiliza.
 * Ahora se usa el método de encolado en Spotify mediante la API `/me/player/queue`.
 */
export async function playTrack(accessToken: string, deviceId: string, trackId: string): Promise<void> {
  const retries = 3;
  const delay = 1000;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const url = `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`;
      const headers = { Authorization: `Bearer ${accessToken}` };
      const body = { uris: [`spotify:track:${trackId}`] };

      await axios.put(url, body, { headers });
      console.log(`playTrack: Played track ${trackId} successfully.`);
      return;
    } catch (error: any) {
      console.error(`playTrack error (attempt ${attempt}):`, error.message);
      if (attempt < retries) await new Promise((res) => setTimeout(res, delay));
      else throw error;
    }
  }
}

// 🔄 Obtener estado del reproductor
export async function getSpotifyPlayerState(accessToken: string): Promise<any> {
  try {
    const res = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: (status) => [200, 204, 404].includes(status),
    });

    if (res.status === 204 || !res.data) {
      return { isPlaying: false, progress_ms: 0, duration_ms: 0, trackId: null };
    }

    const data = res.data;
    const item = data.item;

    return {
      isPlaying: data.is_playing,
      progress_ms: data.progress_ms,
      duration_ms: item?.duration_ms ?? 0,
      trackId: item?.id ?? null,
    };
  } catch (error: any) {
    console.error("getSpotifyPlayerState:", error.message);
    return { isPlaying: false, progress_ms: 0, duration_ms: 0, trackId: null };
  }
}

// 🔐 Obtener token via Electron IPC
export async function getSpotifyAccessToken(): Promise<string> {
  if (!isElectron()) {
    console.warn('Not in Electron environment. Spotify access token cannot be fetched via IPC.');
    // Potentially fall back to a different auth method or throw error if Electron is required
    throw new Error('Not in Electron environment. Required for Spotify authentication.');
  }

  const result = await getValidSpotifyAccessToken();

  if (result.success && result.accessToken) {
    return result.accessToken;
  } else {
    console.error('Failed to get Spotify access token via IPC:', result.error);
    if (result.requiresLogin) {
      // Optionally, trigger a UI update or event to prompt login
      console.log('Spotify login is required.');
    }
    throw new Error(result.error || 'Failed to retrieve Spotify access token.');
  }
}

// ⏯️ Exportar instancia de SpotifyWebApi para transferencias
export const spotifyApi = new SpotifyWebApi();
