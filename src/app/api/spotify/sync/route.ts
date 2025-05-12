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

async function getPlaybackState(accessToken: string): Promise<any | null> {
  const res = await httpClient.get(`${SPOTIFY_BASE_URL}/me/player`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 204) { // No content, indicating no active playback
    return null;
  }

  return res.data;

}

async function playTrack(accessToken: string, deviceId: string, trackId: string) {
  const url = `${SPOTIFY_BASE_URL}/me/player/play?device_id=${deviceId}`;
  const headers = { Authorization: `Bearer ${accessToken}` };
  const body = { uris: [`spotify:track:${trackId}`] };

  await httpClient.put(url, body, { headers });
}

async function getNextTrack(db: admin.database.Database): Promise<any | null> {
  console.error("DEBUG: Intentando obtener siguiente cancion de la cola");
  const snap = await db.ref('/queue').once('value');
  const queue = snap.val() || {};

  const songs = Object.entries(queue).map(([id, val]: any) => ({
    id,
    ...val,
    // Use nullish coalescing for order and spotifyTrackId for robustness
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
    console.error("DEBUG: Iniciando sincronizacion");
    const tokensSnap = await db.ref('/admin/spotify/tokens').once('value');
    const tokens = tokensSnap.val();

    if (!tokens?.refreshToken) {
      await logError('No tokens found in database');
      return NextResponse.json({ error: 'No tokens found' }, { status: 400 });
    }

    const accessToken = await refreshTokenIfNeeded(tokens);
    const deviceId = await getActiveDeviceId(accessToken);
    console.error("DEBUG: Device ID:", deviceId);

    const song = await getNextTrack(db);
    if (!song) {
      return NextResponse.json({ message: 'Queue is empty' });
    }

    const playbackState = await getPlaybackState(accessToken);
    console.error("DEBUG: Playback State:", playbackState);

    const isPlaying = playbackState?.is_playing;
    const currentTrackId = playbackState?.item?.id;

    // Calculate time remaining of the current track in milliseconds
    const progressMs = playbackState?.progress_ms || 0;
    const durationMs = playbackState?.item?.duration_ms || 0;
    const timeRemainingMs = durationMs - progressMs;
    console.error(`DEBUG: isPlaying: ${isPlaying}, currentTrackId: ${currentTrackId}, timeRemainingMs: ${timeRemainingMs}`);
    console.error(`DEBUG: Siguiente cancion ID en cola: ${song.spotifyTrackId}`);

    // If Spotify is not playing, or is playing a different song than the one at the top of the queue,
    // OR if the current song is the correct one but is nearing its end (less than SAFETY_BUFFER_MS remaining)
    if (!isPlaying || currentTrackId !== song?.spotifyTrackId || (currentTrackId === song?.spotifyTrackId && timeRemainingMs < SAFETY_BUFFER_MS)) {
      console.error("DEBUG: Condicion de reproduccion cumplida. Intentando reproducir la siguiente.");
      if (song) { // Ensure 'song' is not null
        // Consider a more robust way to handle removing from the queue after successful play
        // The current logic only removes if the *previous* state's track matched the queued one.
        console.error("DEBUG: Llamando a playTrack para:", song.spotifyTrackId);
        await playTrack(accessToken, deviceId, song.spotifyTrackId);
        if (currentTrackId === song?.spotifyTrackId) await db.ref(`/queue/${song.id}`).remove(); // Only remove if we were playing the correct track
        return NextResponse.json({ success: true, played: song });
      } else {
        return NextResponse.json({ message: 'Queue is empty' });
      }
    } else {
      // Spotify is playing the correct song, do nothing
      console.error("DEBUG: Spotify esta reproduciendo la cancion correcta. No se necesita accion.");
      return NextResponse.json({ message: 'Spotify is playing the correct track.' });
    }
  } catch (err: any) {
    await logError(err.response?.data || err.message || 'Unknown error in sync');
    return NextResponse.json({ error: 'Error: ' + (err?.message || 'desconocido') }, { status: 500 });

  }
}
