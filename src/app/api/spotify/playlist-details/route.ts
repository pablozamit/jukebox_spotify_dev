
import { NextResponse } from 'next/server';
import axios from 'axios';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const playlistId = searchParams.get('playlistId');

  if (!playlistId) {
    return NextResponse.json({ error: 'Falta el parámetro playlistId' }, { status: 400 });
  }

  // Get credentials from environment variables
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Spotify credentials (SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET) missing in environment variables.");
    return NextResponse.json({ error: 'Faltan credenciales de Spotify' }, { status: 500 });
  }

  try {
    // 1) Get Spotify access token (Client Credentials Flow)
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

    // 2) Fetch playlist details from Spotify API
    const playlistRes = await axios.get<{ name: string; description: string; images: { url: string }[] }>(
      `https://api.spotify.com/v1/playlists/${playlistId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          fields: 'name,description,images', // Request name, description, and images
        },
      }
    );

    const playlistDetails = {
      name: typeof playlistRes.data.name === 'string' ? playlistRes.data.name : 'Sin nombre',
      description: typeof playlistRes.data.description === 'string' ? playlistRes.data.description : '',
      imageUrl:
        Array.isArray(playlistRes.data.images) && typeof playlistRes.data.images[0]?.url === 'string'
          ? playlistRes.data.images[0].url
          : null,
    };
    

    return NextResponse.json(playlistDetails);

  } catch (e: any) {
    console.error("Error fetching playlist details from Spotify API:", e.response?.data || e.message || e);
    // Handle common errors like playlist not found (404)
    if (e.response?.status === 404) {
      return NextResponse.json({ error: 'Playlist no encontrada' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Error al conectar con la API de Spotify' }, { status: 500 });
  }
}
