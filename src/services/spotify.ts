// src/services/spotify.ts

import axios from 'axios';
import { get as dbGet, ref as dbRef } from 'firebase/database';
import { db } from '@/lib/firebase';
import SpotifyWebApi from 'spotify-web-api-node';

export interface Song {
  spotifyTrackId: string;
  title: string;
  artist: string;
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
    images?: { url: string }[];
  };
  uri: string;
  preview_url: string | null;
}

// 🔍 Buscar canciones
export async function searchSpotify(
  searchTerm: string,
  config: SpotifyConfig | null,
  offset: number = 0,
  limit: number = 20
): Promise<Song[]> {
  const mode = config?.searchMode ?? 'all';
  const playlistId = config?.playlistId;
  const params = new URLSearchParams({ q: searchTerm, mode });

  if (mode === 'playlist' && playlistId) {
    params.set('playlistId', playlistId);
    params.set('offset', String(offset));
    params.set('limit', String(limit));
  }

  const res = await fetch(`/api/searchSpotify?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Error desconocido al buscar en Spotify' }));
    throw new Error(body.error || `Error ${res.status} buscando en Spotify`);
  }

  const body = await res.json();
  if (!body.results || !Array.isArray(body.results)) {
    console.warn("Spotify API did not return expected 'results' array:", body);
    return [];
  }

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

// ▶️ Reproducir canción directamente por ID
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

// 🔐 Obtener token desde Firebase
export async function getSpotifyAccessToken(): Promise<string> {
  if (!db) {
    throw new Error('Firebase DB no está inicializada');
  }
  const tokensRef = dbRef(db, '/admin/spotify/tokens');
  
  const snapshot = await dbGet(tokensRef);
  const tokens = snapshot.val();

  if (!tokens || !tokens.access_token) {
    throw new Error('No se encontró access_token válido en Firebase');
  }

  return tokens.access_token;
}

// ⏯️ Exportar instancia de SpotifyWebApi para transferencias
export const spotifyApi = new SpotifyWebApi();
