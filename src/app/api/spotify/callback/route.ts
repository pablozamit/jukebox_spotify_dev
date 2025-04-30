// src/app/api/spotify/callback/route.ts

import { NextResponse } from 'next/server';
import axios from 'axios';
import * as admin from 'firebase-admin';

// Inicializa Admin SDK si aún no está hecho
if (!admin.apps.length) {
  admin.initializeApp({
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
  });
}
const db = admin.database();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect('/admin?error=missing_code');
  }

  try {
    // 1) Cambiar el código por tokens
    const tokenRes = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization:
            'Basic ' +
            Buffer.from(
              `${process.env.SPOTIFY_CLIENT_ID!}:${process.env.SPOTIFY_CLIENT_SECRET!}`
            ).toString('base64'),
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    const expiresAt = Date.now() + expires_in * 1000;

    // 2) Guardar tokens en RTDB bajo /spotifyTokens
    await db.ref('/spotifyTokens').set({
      accessToken:  access_token,
      refreshToken: refresh_token,
      expiresAt,
    });

    // 3) Redirigir de vuelta al panel de Admin
    return NextResponse.redirect('/admin?connected=1');
  } catch (err) {
    console.error('Spotify callback error:', err);
    return NextResponse.redirect('/admin?error=callback_failed');
  }
}
