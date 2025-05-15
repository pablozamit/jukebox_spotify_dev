export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';
import * as admin from 'firebase-admin';

const SPOTIFY_BASE_URL = 'https://api.spotify.com/v1';
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

  if (res.status === 204) {
    return null;
  } else if (res.status !== 200) {
    throw new Error(`Spotify API returned status ${res.status} for playback state`);
  }

  return res.data;
}

async function enqueueTrack(accessToken: string, trackUri: string, deviceId?: string) {
  const url = `${SPOTIFY_BASE_URL}/me/player/queue`;
  const params = new URLSearchParams({ uri: trackUri });
  if (deviceId) params.append('device_id', deviceId);

  const headers = { Authorization: `Bearer ${accessToken}` };

  await httpClient.post(`${url}?${params}`, {}, { headers });
}

async function getNextTrack(db: admin.database.Database): Promise<any | null> {
  console.log("DEBUG: Intentando obtener siguiente canción de la cola");
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
    console.log("DEBUG: Iniciando sincronización");
    const tokensSnap = await db.ref('/admin/spotify/tokens').once('value');
    const tokens = tokensSnap.val();

    if (!tokens?.refreshToken) {
      await logError('No tokens found in database');
      return NextResponse.json({ error: 'No tokens found' }, { status: 400 });
    }

    const accessToken = await refreshTokenIfNeeded(tokens);
    const deviceId = await getActiveDeviceId(accessToken);
    console.log("DEBUG: Device ID:", deviceId);

    const playbackState = await getPlaybackState(accessToken);
    const nextQueueSong = await getNextTrack(db);

    if (!nextQueueSong) {
      console.log("DEBUG: No hay canciones en la cola Firebase.");
      return NextResponse.json({ message: 'No tracks in queue' });
    }

    // Nueva condición crítica
    if (playbackState && playbackState.item) {
      const remainingTime = playbackState.item.duration_ms - playbackState.progress_ms;

      if (remainingTime > 10_000) { // más de 10 segundos restantes
        console.log("DEBUG: Más de 10 segundos restantes en la canción actual. Aún no añadimos la siguiente.");
        return NextResponse.json({ message: 'Song still playing, no enqueue yet.' });
      }
    }

    // Procedemos a añadir la canción a la cola si queda poco tiempo
    const trackUri = `spotify:track:${nextQueueSong.spotifyTrackId}`;
const enqueuedKey = `/admin/spotify/enqueuedTracks/${nextQueueSong.id}`;

const alreadyEnqueuedSnap = await db.ref(enqueuedKey).once('value');
if (alreadyEnqueuedSnap.exists()) {
  const timeSince = Date.now() - alreadyEnqueuedSnap.val().timestamp;
  if (timeSince < 60_000) {
    console.log(`DEBUG: Canción ${nextQueueSong.id} ya fue marcada como encolada hace ${timeSince} ms. Se omite.`);
    return NextResponse.json({ message: 'Track already enqueued recently' });
  } else {
    console.warn(`DEBUG: Entrada encolada antigua. Reintentando encolar canción: ${nextQueueSong.id}`);
  }
}

try {
  await enqueueTrack(accessToken, trackUri, deviceId);
  await db.ref(`/queue/${nextQueueSong.id}`).remove();
  await db.ref(enqueuedKey).set({ timestamp: Date.now() });

  console.log(`DEBUG: Canción añadida a cola Spotify y eliminada de Firebase: ${nextQueueSong.spotifyTrackId}`);
  return NextResponse.json({ success: true, enqueued: nextQueueSong });
} catch (err: any) {
  await logError(err.response?.data || err.message || 'Error encolando canción en Spotify');
  console.error("DEBUG: Error encolando canción:", err);
  return NextResponse.json({ error: 'Error encolando canción: ' + err.message }, { status: 500 });
}


try {
  await db.ref(`/queue/${nextQueueSong.id}`).transaction((current) => {
    if (current === null) {
      console.log("DEBUG: La canción ya fue eliminada por otra instancia.");
      return; // otro proceso la eliminó antes
    }
    return null; // marcar para eliminación
  });
  
  await enqueueTrack(accessToken, trackUri, deviceId);
  await db.ref(enqueuedKey).set({ timestamp: Date.now() });
  

  console.log(`DEBUG: Canción añadida a cola Spotify y eliminada de Firebase: ${nextQueueSong.spotifyTrackId}`);
  return NextResponse.json({ success: true, enqueued: nextQueueSong });
} catch (err: any) {

      await logError(err.response?.data || err.message || 'Error encolando canción en Spotify');
      console.error("DEBUG: Error encolando canción:", err);
      return NextResponse.json({ error: 'Error encolando canción: ' + err.message }, { status: 500 });
    }
  } catch (err: any) {
    await logError(err.response?.data || err.message || 'Unknown error in sync');
    console.error("DEBUG: Error en sincronización:", err);
    return NextResponse.json({ error: 'Error: ' + (err?.message || 'desconocido') }, { status: 500 });
  }
}