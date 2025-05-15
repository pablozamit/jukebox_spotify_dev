export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';
import * as admin from 'firebase-admin';

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
  const expiresIn = res.data.expires_in || 3600;
  const expiresAt = now + expiresIn * 1000;

  const db = getFirebaseApp().database();
  await db.ref('/admin/spotify/tokens').update({
    accessToken: newAccessToken,
    expiresAt,
  });

  return newAccessToken;
}

async function getActiveDeviceId(accessToken: string): Promise<string> {
  const res = await axios.get(`${SPOTIFY_BASE_URL}/me/player/devices`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const devices = res.data.devices || [];
  const active = devices.find((d: any) => d.is_active);
  if (active?.id) return active.id;

  if (devices.length > 0) return devices[0].id;

  throw new Error('No active Spotify devices found');
}

export async function POST(req: Request) {
  try {
    const { trackUri } = await req.json();

    if (!trackUri || !trackUri.startsWith('spotify:track:')) {
      return NextResponse.json({ error: 'Invalid or missing trackUri' }, { status: 400 });
    }

    const db = getFirebaseApp().database();
    const tokensSnap = await db.ref('/admin/spotify/tokens').once('value');
    const tokens = tokensSnap.val();

    if (!tokens?.refreshToken) {
      return NextResponse.json({ error: 'No refresh token available' }, { status: 400 });
    }

    const accessToken = await refreshTokenIfNeeded(tokens);
    const deviceId = await getActiveDeviceId(accessToken);

    await axios.put(
      `${SPOTIFY_BASE_URL}/me/player/play?device_id=${deviceId}`,
      { uris: [trackUri] },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('[TransferPlayback] Error:', e?.message || e);
    return NextResponse.json(
      { error: e?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
