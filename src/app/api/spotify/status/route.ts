export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import axios from 'axios';

const SPOTIFY_BASE_URL = 'https://api.spotify.com/v1';

const getFirebaseApp = () => {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
  return admin.app();
};

async function refreshTokenIfNeeded(tokens: any): Promise<string> {
  const now = Date.now();
  if (tokens.accessToken && tokens.expiresAt && now < tokens.expiresAt) {
    return tokens.accessToken;
  }

  const res = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  const newAccessToken = res.data.access_token;
  const expiresIn = res.data.expires_in * 1000;
  const expiresAt = now + expiresIn;

  // Guardamos nuevo token
  const db = getFirebaseApp().database();
  await db.ref('/admin/spotify/tokens').update({
    accessToken: newAccessToken,
    expiresAt,
  });

  return newAccessToken;
}

export async function GET() {
  try {
    const db = getFirebaseApp().database();
    const snapshot = await db.ref('/admin/spotify/tokens').once('value');
    const tokens = snapshot.val();

    if (!tokens || !tokens.refreshToken) {
      return NextResponse.json({
        spotifyConnected: false,
        tokensOk: false,
        playbackAvailable: false,
        reason: 'No hay tokens guardados.',
      });
    }

    const accessToken = await refreshTokenIfNeeded(tokens);

    const test = await axios.get(`${SPOTIFY_BASE_URL}/me/player`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 4000,
    });

    const isPlaying = test.data?.is_playing ?? false;

    return NextResponse.json({
      spotifyConnected: true,
      tokensOk: true,
      playbackAvailable: isPlaying,
    });

  } catch (e: unknown) {
    const message = (e as any)?.message || 'Error desconocido';
    console.error('[Status] Error:', message);

    return NextResponse.json({
      spotifyConnected: false,
      tokensOk: false,
      playbackAvailable: false,
      reason: 'Error: ' + message,
    });
  }
}
