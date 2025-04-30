import { NextResponse } from 'next/server';
import axios from 'axios';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const mode = searchParams.get('mode') ?? 'all';
  const playlistId = searchParams.get('playlistId') ?? '';

  if (!q) {
    return NextResponse.json({ error: 'Missing parameter q' }, { status: 400 });
  }

  // Credenciales desde .env.local
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Spotify credentials missing' }, { status: 500 });
  }

  try {
    // 1) Obtener token
    const tokenRes = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
      }
    );
    const accessToken = tokenRes.data.access_token as string;

    let tracks: any[] = [];

    // 2) Lógica condicional
    if (mode === 'playlist') {
      if (!playlistId) {
        return NextResponse.json({ error: 'Missing playlistId' }, { status: 400 });
      }
      const plRes = await axios.get(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            fields: 'items(track(id,name,artists(name),album(name),uri,preview_url))',
            limit: 100,
          },
        }
      );
      const ql = q.toLowerCase();
      tracks = (plRes.data.items || [])
        .map((i: any) => i.track)
        .filter((t: any) =>
          t.name.toLowerCase().includes(ql) ||
          t.artists.some((a: any) => a.name.toLowerCase().includes(ql))
        );
    } else {
      const srRes = await axios.get('https://api.spotify.com/v1/search', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { q, type: 'track', limit: 20 },
      });
      tracks = srRes.data.tracks.items || [];
    }

    // 3) Formatear y devolver
    const results = tracks.map(t => ({
      id: t.id,
      name: t.name,
      artists: t.artists.map((a: any) => a.name),
      album: t.album.name,
      uri: t.uri,
      preview_url: t.preview_url,
    }));

    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Spotify API error' }, { status: 500 });
  }
}
