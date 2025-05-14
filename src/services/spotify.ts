// src/services/spotify.ts

import axios from 'axios';

export interface Song {
  /** El ID de la pista en Spotify */
  spotifyTrackId: string;
  /** Título de la canción */
  title: string;
  /** Artistas (concatenados en una cadena) */
  artist: string;
  /** URL de la portada del álbum */
  albumArtUrl?: string | null;
}

export interface SpotifyConfig {
  searchMode: 'all' | 'playlist';
  playlistId?: string;
  spotifyConnected: boolean;
}

interface SpotifyTrack {
  id: string;
  name: string;
  artists: { name: string }[];
  album: {
    name: string;
    images?: { url: string }[]; // Optional images array
  };
  uri: string;
  preview_url: string | null;
}

/**
 * Llama a tu API interna de Next.js en /api/searchSpotify
 */
export async function searchSpotify(
  searchTerm: string,
  config: SpotifyConfig | null,
  offset: number = 0,
  limit: number = 20,
): Promise<Song[]> {
  const mode = config?.searchMode ?? 'all';
  const playlistId = config?.playlistId;

  // Build query string
  const params = new URLSearchParams({ q: searchTerm, mode });
  if (mode === 'playlist' && playlistId) {
    params.set('playlistId', playlistId);
    params.set('offset', String(offset));
    params.set('limit', String(limit));
  }

  const res = await fetch(`/api/searchSpotify?${params.toString()}`);

  if (!res.ok) {
    const body = await res
      .json()
      .catch(() => ({ error: 'Error desconocido al buscar en Spotify' }));
    throw new Error(body.error || `Error ${res.status} buscando en Spotify`);
  }

  const body = await res.json();

  if (!body.results || !Array.isArray(body.results)) {
    console.warn(
      "Spotify API did not return expected 'results' array:",
      body
    );
    return [];
  }

  // Map the API response to the Song interface
  return (body.results as SpotifyTrack[])
    .filter(
      (t): t is SpotifyTrack =>
        t &&
        typeof t.id === 'string' &&
        typeof t.name === 'string' &&
        Array.isArray(t.artists) &&
        t.artists.every((a) => a && typeof a.name === 'string')
    )
    .map((t) => ({
      spotifyTrackId: t.id,
      title: t.name,
      artist: t.artists.map((a) => a.name).join(', '),
      albumArtUrl: Array.isArray(t.album?.images) ? t.album.images[0]?.url ?? null : null,
    }));
}

/**
 * Reproduce una pista en Spotify usando la API de Spotify
 */
export async function playTrack(accessToken: string, deviceId: string, trackId: string): Promise<void> {
  const retries = 3;
  const delay = 1000; // 1 segundo de espera entre intentos

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Attempt ${attempt} to play track ${trackId} on device ${deviceId}`);
      const url = `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`;
      const headers = { Authorization: `Bearer ${accessToken}` };
      const body = { uris: [`spotify:track:${trackId}`] };

      await axios.put(url, body, { headers });
      console.log(`playTrack: Played track ${trackId} successfully.`);
      return; // Éxito, salir de la función
    } catch (error: any) {
      console.error(`playTrack: Error during attempt ${attempt}: ${error.message}`);
      if (attempt < retries) {
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(res => setTimeout(res, delay)); // Esperar antes de reintentar
      } else {
        console.error("Max retry attempts reached. Giving up.");
        throw error; // Lanzar el error final si se alcanzan los intentos máximos
      }
    }
  }
}

/**
 * Obtiene el estado actual del reproductor de Spotify
 */
export async function getSpotifyPlayerState(accessToken: string): Promise<any> {
  console.log('getSpotifyPlayerState: Attempting to get player state.');
  try {
    const res = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: (status) => status === 200 || status === 204 || status === 404,
    });

    if (res.status === 204 || !res.data) {
      console.log("getSpotifyPlayerState: No song is currently playing.");
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
    console.error("getSpotifyPlayerState: Error fetching player state:", error.message, error.stack);
    return { isPlaying: false, progress_ms: 0, duration_ms: 0, trackId: null }; // Devuelve estado predeterminado si hay error
  }
}