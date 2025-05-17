// ➤ Fuerza este handler a ejecutarse en Node.js, no en Edge
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';
import * as admin from 'firebase-admin';
import crypto from 'crypto';

const SPOTIFY_BASE_URL = 'https://api.spotify.com/v1';
const SPOTIFY_API_TIMEOUT = 5000;
const SYNC_LOCK_PATH = '/admin/spotify/syncLock';
const LOCK_TIMEOUT_MS = 15000; // 15 segundos

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
  const operationId = crypto.randomUUID();
  console.log(`[SYNC ${operationId}] Intentando obtener siguiente canción de la cola`);
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
  const operationId = crypto.randomUUID();
  const db = getFirebaseApp().database();
  await db.ref('/admin/spotify/lastError').set({
    message,
    timestamp: Date.now(),
  });
  console.log(`[SYNC ${operationId}] Error registrado: ${message}`);
}

export async function POST() {
  const operationId = crypto.randomUUID();
  console.log(`[SYNC ${operationId}] Iniciando sincronización...`);

  const db = getFirebaseApp().database();
  const lockRef = db.ref(SYNC_LOCK_PATH);
  let lockAcquired = false;

  try {
    // 1. Intentar adquirir el lock
    const transactionResult = await lockRef.transaction((currentData) => {
      const now = Date.now();
      console.log(`[SYNC ${operationId}] currentData del lock:`, currentData);
    
      if (!currentData || !currentData.expiresAt || currentData.expiresAt < now) {
        return { active: true, expiresAt: now + LOCK_TIMEOUT_MS, by: 'sync-route-v2' };
      }
    
      return; // Lock sigue activo
    });
    

    if (!transactionResult.committed || !transactionResult.snapshot?.val()?.active) {
      console.log(`[SYNC ${operationId}] Sincronización ya en progreso o lock falló. Saliendo.`);
      return NextResponse.json({ message: 'Sync already in progress or lock failed.' }, { status: 429 });
    }

    lockAcquired = true;
    console.log(`[SYNC ${operationId}] Lock de sincronización adquirido.`);

    // --- LÓGICA DE SINCRONIZACIÓN ---
    const tokensSnap = await db.ref('/admin/spotify/tokens').once('value');
    const tokens = tokensSnap.val();

    if (!tokens?.refreshToken) {
      await logError('No tokens found in database for sync');
      return NextResponse.json({ error: 'No tokens found' }, { status: 400 });
    }

    const accessToken = await refreshTokenIfNeeded(tokens);
    const deviceId = await getActiveDeviceId(accessToken);
    console.log(`[SYNC ${operationId}] Device ID: ${deviceId}`);

    const playbackState = await getPlaybackState(accessToken);
    const nextQueueSong = await getNextTrack(db);

    // ——— Gestión de estado para evitar encolados dobles ———
    const syncStateRef = db.ref('/admin/spotify/syncState');
    const syncStateSnap = await syncStateRef.once('value');
    const syncState = syncStateSnap.val() || { lastTrackId: null, hasQueuedNext: false };
    let { lastTrackId, hasQueuedNext } = syncState;

    // ID de la pista actual de Spotify
    const currentTrackId = playbackState?.item?.id || null;

    // Si cambió de canción, reseteamos el flag
    if (currentTrackId !== lastTrackId) {
      lastTrackId = currentTrackId;
      hasQueuedNext = false;
    }

    if (!nextQueueSong) {
      console.log(`[SYNC ${operationId}] No hay canciones en la cola Firebase.`);
      return NextResponse.json({ message: 'No tracks in Firebase queue' });
    }

    let shouldEnqueue = false;

    if (!playbackState || !playbackState.item) {
      console.log(`[SYNC ${operationId}] No hay canción activa. Se debe encolar la primera de Firebase.`);
      shouldEnqueue = true;
    } else {
      const remainingTime = playbackState.item.duration_ms - playbackState.progress_ms;
    
      if (playbackState.is_playing && remainingTime <= 10_000) {
        console.log(`[SYNC ${operationId}] Quedan ${remainingTime / 1000}s y está sonando. Se debe encolar.`);
        shouldEnqueue = true;
      } else {
        console.log(`[SYNC ${operationId}] No se encola. Estado: ${playbackState.is_playing ? 'sonando' : 'pausado'}, quedan ${remainingTime / 1000}s`);
      }
    }

    // Si no toca encolar, o ya lo hicimos para esta pista, salimos
    if (!shouldEnqueue || hasQueuedNext) {
      await syncStateRef.update({ lastTrackId, hasQueuedNext });
      return NextResponse.json({ message: 'Nothing to enqueue', enqueued: false });
    }

    // --- Lógica de encolar y eliminar la PRIMERA canción ---
    const trackUri = `spotify:track:${nextQueueSong.spotifyTrackId}`;
    const firebaseQueuePath = `/queue/${nextQueueSong.id}`;

    await enqueueTrack(accessToken, trackUri, deviceId);
    console.log(`[SYNC ${operationId}] Canción ${nextQueueSong.id} (${trackUri}) añadida a cola Spotify.`);

    // Eliminar la canción de la cola de Firebase
    await db.ref(firebaseQueuePath).remove();
    console.log(`[SYNC ${operationId}] Canción ${nextQueueSong.id} eliminada de Firebase queue.`);

    // Marcamos que ya encolamos para esta pista
    hasQueuedNext = true;
    await syncStateRef.update({ lastTrackId, hasQueuedNext });

    // Actualizar el ID de la canción que ahora está "sonando"
    await db.ref('/admin/spotify/nowPlayingId').set({
      id: nextQueueSong.spotifyTrackId,
      title: nextQueueSong.title || "N/A",
      artist: nextQueueSong.artist || "N/A",
      source: 'jukebox-sync',
      timestamp: Date.now(),
    });
    console.log(`[SYNC ${operationId}] nowPlayingId actualizado en Firebase a ${nextQueueSong.spotifyTrackId}.`);

    return NextResponse.json({ success: true, enqueued: nextQueueSong });

  } catch (err: any) {
    await logError(err.response?.data?.error?.message || err.message || 'Unknown error in sync POST handler');
    console.error(`[SYNC ${operationId}] Error en la función POST de sincronización:`, err);
    return NextResponse.json({ error: 'Error: ' + (err.message || 'desconocido') }, { status: err.response?.status || 500 });

  } finally {
    // 2. Liberar el lock
    if (lockAcquired) {
      await lockRef.update({ active: false, releasedTimestamp: Date.now() });
      console.log(`[SYNC ${operationId}] Lock liberado.`);
    }
  }
}