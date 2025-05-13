
import { NextResponse } from 'next/server';
import axios from 'axios';

// Define a type for the expected track item from Spotify API
interface SpotifyTrackItem {
  id: string;
  name: string;
  artists: { name: string }[];
  album: {
    name: string;
    images?: { url: string }[]; // Include images array
  };
  uri: string;
  preview_url: string | null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const mode = searchParams.get('mode') ?? 'all';
  const playlistId = searchParams.get('playlistId') ?? '';
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);
  const limit = parseInt(searchParams.get('limit') ?? '20', 10);

  if (!q && mode === 'all') {
    return NextResponse.json({ error: 'Falta el parámetro q' }, { status: 400 });
  }

  // Get credentials from environment variables
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Spotify credentials (SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET) missing in environment variables.");
    return NextResponse.json({ error: 'Faltan credenciales de Spotify' }, { status: 500 });
  }

  try {
    // 1) Get Spotify access token
    const tokenRes = await axios.post<{ access_token: string }>(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
      }
    );
    const accessToken = tokenRes.data.access_token;

    let tracks: SpotifyTrackItem[] = [];

    // 2) Conditional search logic
    if (mode === 'playlist') {
      if (!playlistId) {
        return NextResponse.json({ error: 'Falta playlistId para el modo playlist' }, { status: 400 });
      }

      const plRes = await axios.get<{ items: { track: SpotifyTrackItem }[] }>(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            fields: 'items(track(id,name,artists(name,href),album(name,images),uri,preview_url))',
            limit: limit,
            offset: offset,
          },
        }
      );

      const playlistTracks = plRes.data.items?.map(item => item.track).filter(Boolean) ?? [];

      if (q) {
        const ql = q.toLowerCase();
        tracks = playlistTracks.filter((t) =>
          (t.name && t.name.toLowerCase().includes(ql)) ||
          (t.artists && t.artists.some((a) => a.name && a.name.toLowerCase().includes(ql)))
        );
      } else {
          tracks = playlistTracks;
      }

    } else {
      const srRes = await axios.get<{ tracks: { items: SpotifyTrackItem[] } }>(
        'https://api.spotify.com/v1/search',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { q, type: 'track', limit: 20 },
        }
      );
      tracks = Array.isArray(srRes.data?.tracks?.items) ? srRes.data.tracks.items : [];

    }

    const results = tracks.map(t => ({
      spotifyTrackId: t.id,
      title: t.name,
 artist: Array.isArray(t.artists) && t.artists.length > 0 ? t.artists.map(a => a.name).join(', ') : '',
      album: {
        name: t.album?.name ?? "",
 images: Array.isArray(t.album?.images) ? t.album.images : [],
      },
      uri: t.uri,
      preview_url: t.preview_url,
    }));

    if (!Array.isArray(tracks)) {
      console.warn('⚠️ tracks no es un array válido');
      return NextResponse.json({ results: [] });
    }
    return NextResponse.json({ results: results ?? [] });
    


  } catch (e: any) {
    console.error("Error interacting with Spotify API:", e.response?.data || e.message || e);
    // Handle common errors like playlist not found (404)
    if (e.response?.status === 404) {
      return NextResponse.json({ error: 'Playlist no encontrada' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Error al conectar con la API de Spotify' }, { status: 500 });
  }
}
