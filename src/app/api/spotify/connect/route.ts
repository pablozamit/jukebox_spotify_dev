// ➤ Fuerza este handler a ejecutarse en Node.js, no en Edge
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  console.log('--- Inicio del endpoint /api/spotify/connect ---');
  const clientId       = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri  = process.env.SPOTIFY_REDIRECT_URI;

  console.log('Client ID:', clientId);
  console.log('Redirect URI:', redirectUri);

  if (!clientId || !redirectUri) {
    console.error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_REDIRECT_URI');
    console.log('--- Fin del endpoint /api/spotify/connect (error: config missing) ---');
    return NextResponse.json(
      { error: 'Spotify OAuth not configured on the server.' },
      { status: 500 }
    );
  }

  // ❶ Generar un state aleatorio para CSRF
  const state = Math.random().toString(36).slice(2);
  console.log('Generated state:', state);

  // ❷ Guardarlo en cookie HTTP-only
  const cookieStore = await cookies();
  cookieStore.set({
    name:     'spotify_auth_state',
    value:    state,
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    path:     '/api/spotify/callback',
    maxAge:   60 * 60,
  });
  console.log('State cookie set:', state);

  // ❸ Construir la URL de autorización de Spotify
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  redirectUri,
    scope:         'user-modify-playback-state user-read-playback-state',
    state,
  });

  const authorizeUrl = `https://accounts.spotify.com/authorize?$${params}`;
  console.log('Spotify Authorize URL:', authorizeUrl);
  console.log('--- Fin del endpoint /api/spotify/connect (redirecting) ---');
  return NextResponse.redirect(authorizeUrl);
}