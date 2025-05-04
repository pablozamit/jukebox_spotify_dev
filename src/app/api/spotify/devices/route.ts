export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  });
}

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;

export async function GET() {
  try {
    const snap = await admin.database().ref('/admin/spotify/tokens').once('value');
    const tokens = snap.val();

    if (!tokens) {
      return NextResponse.json({ error: 'No Spotify tokens found' }, { status: 400 });
    }

    let accessToken = tokens.accessToken;
    const now = Date.now();

    if (now >= tokens.expiresAt) {
      const res = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
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

      accessToken = res.data.access_token;
      const newExpiry = Date.now() + res.data.expires_in * 1000;

      await admin.database().ref('/admin/spotify/tokens').update({
        accessToken,
        expiresAt: newExpiry,
      });
    }

    // Obtener dispositivos
    const devicesRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = await devicesRes.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('devices error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
