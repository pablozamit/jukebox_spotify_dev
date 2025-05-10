export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';
import * as admin from 'firebase-admin';

// Inicializar Admin SDK si no está ya inicializado
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;

async function getValidAccessToken(): Promise<string> {
  const snap = await admin.database().ref('/admin/spotify/tokens').once('value');
  const tokens = snap.val() as
    | { accessToken: string; refreshToken: string; expiresAt: number }
    | null;

  if (!tokens) throw new Error('No Spotify tokens found.');

  const now = Date.now();
  if (now < tokens.expiresAt) {
    return tokens.accessToken;
  }

  // Token expirado → refrescar
  const refreshRes = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
      },
    }
  );

  const newAccessToken = refreshRes.data.access_token;
  const newExpiresAt = Date.now() + refreshRes.data.expires_in * 1000;

  await admin
    .database()
    .ref('/admin/spotify/tokens')
    .update({ accessToken: newAccessToken, expiresAt: newExpiresAt });

  return newAccessToken;
}

export async function GET() {
  try {
    const accessToken = await getValidAccessToken();

    const playerRes = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 4000,
validateStatus: () => true,

    });

    if (playerRes.status === 204 || !playerRes.data) {
      return NextResponse.json({ isPlaying: false });
    }

    const data = playerRes.data;
    const item = data.item;
    if (!item) {
      return NextResponse.json({ isPlaying: false });
    }

    const track = {
      id: item.id,
      name: item.name,
      artists: item.artists.map((a: any) => a.name),
      albumArtUrl: item.album?.images?.[0]?.url ?? null,
      progress_ms: data.progress_ms,
      duration_ms: item.duration_ms,
    };

    return NextResponse.json({ isPlaying: true, track });
  } catch (e: any) {
    console.error('[Current] Error al obtener canción actual:', e?.message || e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
