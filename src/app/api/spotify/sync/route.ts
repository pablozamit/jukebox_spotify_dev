// app/api/spotify/sync/route.ts
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

export async function POST() {
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
            Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
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

    const queueSnap = await admin.database().ref('/queue').once('value');
    const queueData = queueSnap.val();

    if (!queueData) {
      return NextResponse.json({ message: 'Queue is empty' });
    }

    const songs = Object.entries(queueData).map(([id, val]: any) => ({
      id,
      ...(val as any),
      votes: val.votes ?? 0,
    }));

    const sorted = songs.sort((a, b) => b.votes - a.votes || (a.order ?? 0) - (b.order ?? 0));
    const topSong = sorted[0];

    if (!topSong) {
      return NextResponse.json({ message: 'No top song found' });
    }

    const addRes = await fetch(
      `https://api.spotify.com/v1/me/player/play`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uris: [`spotify:track:${topSong.spotifyTrackId}`],
        }),
      }
    );

    if (!addRes.ok) {
      const err = await addRes.json().catch(() => ({}));
      return NextResponse.json({ error: err.error?.message || 'Failed to play track' }, { status: addRes.status });
    }

    await admin.database().ref(`/queue/${topSong.id}`).remove();

    return NextResponse.json({ success: true, played: topSong });
  } catch (e: any) {
    console.error('sync error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
