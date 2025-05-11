export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import axios from 'axios';

const SPOTIFY_BASE_URL = 'https://api.spotify.com/v1';

const getFirebaseApp = () => {
  if (!admin.apps.length) {
    const raw = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON!);
    admin.initializeApp({
      credential: admin.credential.cert(raw),
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

    if (!tokens?.refreshToken) {
      return NextResponse.json({
        spotifyConnected: false,
        tokensOk: false,
        playbackAvailable: false,
        message: 'No hay tokens guardados.',
      });
    }

    const accessToken = await refreshTokenIfNeeded(tokens);

    const test = await axios.get(`${SPOTIFY_BASE_URL}/me/player`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 4000,
    });

    const data = test.data || {};
    const activeDevice = Array.isArray(data.devices)
      ? data.devices.find((d: any) => d.is_active)
      : data.device;

    return NextResponse.json({
      spotifyConnected: true,
      tokensOk: true,
      playbackAvailable: data.is_playing ?? false,
      activeDevice: activeDevice
        ? {
            id: activeDevice.id,
            name: activeDevice.name,
            type: activeDevice.type,
          }
        : null,
      message: 'Estado verificado correctamente.',
    });
  } catch (e: any) {
    console.error('[Status] Error:', e?.message || e);
    return NextResponse.json({
      spotifyConnected: false,
      tokensOk: false,
      playbackAvailable: false,
      message: 'Error: ' + (e?.message || 'desconocido'),
    });
  }
}
