export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import axios from 'axios';

async function getValidAccessToken(): Promise<string> {
  const snap = await adminDb?.ref('/admin/spotify/tokens').once('value');
  if (!snap) throw new Error('No snapshot returned from Firebase.');
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
        Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
      },
    }
  );

  const newAccessToken = refreshRes.data.access_token;
  const newExpiresAt = Date.now() + refreshRes.data.expires_in * 1000;

  await adminDb?.ref('/admin/spotify/tokens').update({
    accessToken: newAccessToken,
    expiresAt: newExpiresAt,
  });

  return newAccessToken;
}

export async function GET() {
  console.log('Executing spotify/current route');

  // Explicitly log adminDb for debugging
  console.log('adminDb from firebaseAdmin.ts:', adminDb);

  try {
    const accessToken = await getValidAccessToken();

    const playerRes = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 4000,
      validateStatus: () => true,
    });

    if (playerRes.status === 204 || !playerRes.data) {
      return NextResponse.json({ isPlaying: false, track: null }); // Indicar inactivo y sin canción
    }

    const data = playerRes.data;
    const item = data?.item;

    if (!data || !item) {
      return NextResponse.json({ isPlaying: false, track: null }); // Indicar inactivo y sin canción
    }

    const isPlaying = data.is_playing; // Obtener el estado de reproducción

    const track = {
      id: item.id ?? null,
      name: item.name ?? '',
      artists: item.artists?.map((a: any) => a.name) ?? [],
      albumArtUrl: item.album?.images?.[0]?.url ?? null,
      progress_ms: data.progress_ms ?? 0,
      duration_ms: item.duration_ms ?? 0,
    };

    return NextResponse.json({ isPlaying: isPlaying, track }); // Devolver el estado de reproducción y la canción

  } catch (e: any) {
    console.error('[Current] Error al obtener canción actual:', e?.message || e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}