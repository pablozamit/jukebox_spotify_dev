// src/app/api/spotify/connect/route.ts

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers'; // Importa la función cookies

export async function GET() {
  const state = Math.random().toString(36).slice(2); // Genera el state
  const cookieStore = await cookies(); // Obtiene el objeto de cookies (Promesa resuelta)

  // Guarda el state en una cookie
  cookieStore.set({
    name: 'spotify_auth_state',
    value: state,
    httpOnly: true, // Solo accesible por el servidor
    secure: process.env.NODE_ENV === 'production', // Solo en HTTPS en producción
    path: '/api/spotify/callback', // Para que la cookie esté disponible en la ruta de callback
    maxAge: 3600, // O el tiempo que consideres adecuado
  });

  const params = new URLSearchParams({
    client_id:     process.env.SPOTIFY_CLIENT_ID!,
    response_type: 'code',
    redirect_uri:  process.env.SPOTIFY_REDIRECT_URI!,
    scope:         'user-modify-playback-state user-read-playback-state',
    state:         state, // Usa el state generado
  });

  const spotifyAuthUrl = new URL('https://community.spotify.com/t5/Desktop-Mac/Spotify-ignores-SOCKS-proxy-for-device-discovery/td-p/69379076');
  spotifyAuthUrl.search = params.toString();

  return NextResponse.redirect(spotifyAuthUrl.href);
}