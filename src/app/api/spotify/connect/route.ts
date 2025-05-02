// src/app/api/spotify/connect/route.ts

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    console.error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_REDIRECT_URI');
    return NextResponse.json(
      { error: 'Spotify OAuth not configured on the server.' },
      { status: 500 }
    );
  }

  // ❶ Generar un state aleatorio para CSRF
  const state = Math.random().toString(36).slice(2);

  // ❷ Guardarlo en cookie HTTP-only
  const cookieStore = await cookies();
  cookieStore.set({
    name: 'spotify_auth_state',
    value: state,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/api/spotify/callback',  // también funciona para cualquier subruta de callback
    maxAge: 60 * 60,               // 1 hora
  });

  // ❸ Construir la URL de autorización de Spotify
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  redirectUri,
    scope:         'user-modify-playback-state user-read-playback-state',
    state,
  });

  const spotifyAuthUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;
  return NextResponse.redirect(spotifyAuthUrl);
}
