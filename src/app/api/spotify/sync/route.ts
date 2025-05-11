export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';
import * as admin from 'firebase-admin';

const SPOTIFY_BASE_URL = 'https://api.spotify.com/v1';
const SAFETY_BUFFER_MS = 3000;
const SPOTIFY_API_TIMEOUT = 5000;

const httpClient = axios.create({ timeout: SPOTIFY_API_TIMEOUT });

const getFirebaseApp = () => {
  if (!admin.apps.length) {
    const raw = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON!);
    admin.initializeApp({
      credential: admin.credential.cert(raw),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });

  }
  if (!admin.apps.length) {
  }
  return admin.app();
};

async function refreshTokenIfNeeded(tokens: any): Promise<string> {
  const now = Date.now();
  if (tokens.expiresAt && tokens.expiresAt > now + 60_000) {
    return tokens.accessToken;
  }

  const refreshRes = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const newAccessToken = refreshRes.data.access_token;
  const expiresIn = refreshRes.data.expires_in || 3600;

  const db = getFirebaseApp().database();
  await db.ref('/admin/spotify/tokens').update({
    accessToken: newAccessToken,
    expiresAt: now + expiresIn * 1000,
  });

  return newAccessToken;
}

async function getActiveDeviceId(accessToken: string): Promise<string> {
  const res = await httpClient.get(`${SPOTIFY_BASE_URL}/me/player/devices`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const device = res.data.devices.find((d: any) => d.is_active) || res.data.devices[0];
  if (!device?.id) throw new Error('No active Spotify devices found');
  return device.id;
}

async function checkShouldPlay(accessToken: string): Promise<boolean> {
  const res = await httpClient.get(`${SPOTIFY_BASE_URL}/me/player`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const isPlaying = res.data?.is_playing;
  const progress = res.data?.progress_ms;
  const duration = res.data?.item?.duration_ms;
  const remaining = duration - progress;

  return !isPlaying || remaining < SAFETY_BUFFER_MS;
}

async function playTrack(accessToken: string, deviceId: string, trackId: string) {
  const url = `${SPOTIFY_BASE_URL}/me/player/play?device_id=${deviceId}`;
  const headers = { Authorization: `Bearer ${accessToken}` };
  const body = { uris: [`spotify:track:${trackId}`] };

  await httpClient.put(url, body, { headers });
}

async function getNextTrack(db: admin.database.Database): Promise<any | null> {
  const snap = await db.ref('/queue').once('value');
  const queue = snap.val() || {};

  const songs = Object.entries(queue).map(([id, val]: any) => ({
    id,
    ...val,
    order: val.order ?? val.timestampAdded ?? 0,
    spotifyTrackId: val.spotifyTrackId ?? val.id,
  }));

  songs.sort((a, b) => a.order - b.order);
  return songs[0] || null;
}

async function logError(message: string) {
  const db = getFirebaseApp().database();
  await db.ref('/admin/spotify/lastError').set({
    message,
    timestamp: Date.now(),
  });
}

export async function POST() {
  const db = getFirebaseApp().database();

  try {
    const tokensSnap = await db.ref('/admin/spotify/tokens').once('value');
    const tokens = tokensSnap.val();

    if (!tokens?.refreshToken) {
      await logError('No tokens found in database');
      return NextResponse.json({ error: 'No tokens found' }, { status: 400 });
    }

    const accessToken = await refreshTokenIfNeeded(tokens);
    const deviceId = await getActiveDeviceId(accessToken);

    const shouldPlay = await checkShouldPlay(accessToken);
    if (!shouldPlay) {
      return NextResponse.json({ message: 'Playback in progress, skipping sync' });
    }

    const song = await getNextTrack(db);
    if (!song) {
      return NextResponse.json({ message: 'Queue is empty' });
    }

    await playTrack(accessToken, deviceId, song.spotifyTrackId);
    // OMITIR pausa si estamos bajo tiempo limitado


    const playback = await httpClient.get(`${SPOTIFY_BASE_URL}/me/player`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 4000,
    });
    

    const currentTrackId = playback.data?.item?.id;
    const isPlaying = playback.data?.is_playing;

    if (isPlaying && currentTrackId === song.spotifyTrackId) {
      await db.ref(`/queue/${song.id}`).remove();
      return NextResponse.json({ success: true, played: song });
    } else {
      return NextResponse.json({ warning: 'Track not confirmed as playing', queued: song });
    }

  } catch (err: any) {
    await logError(err.response?.data || err.message || 'Unknown error in sync');
    return NextResponse.json({ error: 'Error: ' + (err?.message || 'desconocido') }, { status: 500 });

  }
}
