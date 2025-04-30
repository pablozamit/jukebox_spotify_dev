// src/services/spotify.ts

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
  config: SpotifyConfig | null
): Promise<Song[]> {
  const mode = config?.searchMode ?? 'all';
  const playlistId = config?.playlistId;

  // Build query string
  const params = new URLSearchParams({ q: searchTerm, mode });
  if (mode === 'playlist' && playlistId) {
    params.set('playlistId', playlistId);
  }

  const res = await fetch(`/api/searchSpotify?${params.toString()}`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Error desconocido al buscar en Spotify' })); // Graceful error handling for JSON parse
    throw new Error(body.error || `Error ${res.status} buscando en Spotify`);
  }

   const body = await res.json();

   if (!body.results || !Array.isArray(body.results)) {
      console.warn("Spotify API did not return expected 'results' array:", body);
      return []; // Return empty array if results are missing or not an array
   }

  // Map the API response to the Song interface
  return (body.results as SpotifyTrack[]).map((t) => ({
    spotifyTrackId: t.id,
    title: t.name,
    artist: t.artists.map((a) => a.name).join(', '),
    // Get the first available album image URL, or null if none exist
    albumArtUrl: t.album?.images?.[0]?.url ?? null,
  }));
}
```