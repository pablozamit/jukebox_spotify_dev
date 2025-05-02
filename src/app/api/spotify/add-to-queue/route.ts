// ➤ Fuerza este handler a ejecutarse en Node.js, no en Edge
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';
import * as admin from 'firebase-admin';

// ❶ Inicializa Admin SDK con Application Default Credentials
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  });
}

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;

export async function POST(request: Request) {
  try {
    // ❷ Leemos trackId del body
    const { trackId } = await request.json();
    if (!trackId) {
      return NextResponse.json({ error: 'trackId is required' }, { status: 400 });
    }

    // ❸ Leemos tokens de RTDB en /admin/spotify/tokens
    const snap = await admin.database().ref('/admin/spotify/tokens').once('value');
    const tokens = snap.val() as
      | { accessToken: string; refreshToken: string; expiresAt: number }
      | null;

    if (!tokens) {
      return NextResponse.json(
        { error: 'No Spotify tokens found. Connect first.' },
        { status: 400 }
      );
    }

    let accessToken = tokens.accessToken;
    const now = Date.now();

    // ❹ Si expiró, lo refrescamos y actualizamos RTDB
    if (now >= tokens.expiresAt) {
      const resp = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type:    'refresh_token',
          refresh_token: tokens.refreshToken,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization:
              'Basic ' +
              Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
          },
        }
      );

      accessToken = resp.data.access_token;
      const newExpiry = Date.now() + resp.data.expires_in * 1000;

      await admin
        .database()
        .ref('/admin/spotify/tokens')
        .update({ accessToken, expiresAt: newExpiry });
    }

    // ❺ Encolamos la pista en Spotify
    const queueRes = await fetch(
      `https://api.spotify.com/v1/me/player/queue?uri=spotify:track:${trackId}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!queueRes.ok) {
      const err = await queueRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.error?.message || 'Failed to add to Spotify queue' },
        { status: queueRes.status }
      );
    }

    // ❻ Éxito
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('add-to-queue error:', e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
