// src/app/api/spotify/connect/route.ts

// ➤ Este handler corre en el Edge Runtime (más rápido para redirects)
export const runtime = 'edge';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const clientId    = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    console.error('Faltan SPOTIFY_CLIENT_ID o SPOTIFY_REDIRECT_URI en las env vars.');
    return NextResponse.json(
      { error: 'OAuth de Spotify no configurado en el servidor.' },
      { status: 500 }
    );
  }

  // ❶ Generar un state aleatorio para proteger contra CSRF
  const state = Math.random().toString(36).substring(2);

  // ❷ Guardar el state en una cookie HTTP‑only
  const cookieStore = await cookies();
  cookieStore.set({
    name:     'spotify_auth_state',
    value:    state,
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    path:     '/api/spotify/callback', // estará disponible en /api/spotify/callback
    maxAge:   60 * 60                   // 1 hora
  });

  // ❸ Construir la URL de autorización de Spotify
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  redirectUri,
    scope:         'user-modify-playback-state user-read-playback-state',
    state,
  });

  const authorizeUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;
  return NextResponse.redirect(authorizeUrl);
}
