export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios, { AxiosError } from 'axios';
import * as admin from 'firebase-admin';

// ───── Configuración ────────────────────────────
const SPOTIFY_API_TIMEOUT = 5000;
const SAFETY_BUFFER_MS = 3000;
const RETRY_DELAY_MS = 30000;
const MAX_RETRIES = 3;
const SPOTIFY_BASE_URL = 'https://api.spotify.com/v1';

// ───── Firebase ─────────────────────────────────
const getFirebaseApp = () => {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    });
  }
  return admin.app();
};

// ───── Axios reutilizable ───────────────────────
const httpClient = axios.create({
  timeout: SPOTIFY_API_TIMEOUT,
});

// ───── Reintento automático Spotify API ─────────
async function callSpotifyApiWithRetry(
  url: string,
  headers: any,
  method: 'get' | 'post' | 'put' | 'delete',
  body: any = null,
  retryCount = 0
): Promise<any> {
  try {
    console.log(`[Spotify API] Attempt ${retryCount + 1}: ${method.toUpperCase()} ${url}`);
    const res = await httpClient({
      url,
      method,
      headers,
      data: body,
    });
    return res.data;
  } catch (error: any) {
    const axiosError = error as AxiosError;
    console.error(`[Spotify API] Error on attempt ${retryCount + 1}: ${axiosError.message}`);

    if (retryCount < MAX_RETRIES && axiosError.response?.status !== 401) {
      console.log(`[Spotify API] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise((res) => setTimeout(res, RETRY_DELAY_MS));
      return callSpotifyApiWithRetry(url, headers, method, body, retryCount + 1);
    }

    throw axiosError;
  }
}

// ───── Refrescar token y obtener device ─────────
async function handleTokenAndDevice(tokens: any): Promise<[string, string]> {
  // Refrescar access_token
  const refreshRes = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  const accessToken = refreshRes.data.access_token;

  // Obtener device activo
  const deviceRes = await axios.get(`${SPOTIFY_BASE_URL}/me/player/devices`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const device = deviceRes.data.devices.find((d: any) => d.is_active) || deviceRes.data.devices[0];

  if (!device?.id) throw new Error('No active Spotify devices found');

  return [accessToken, device.id];
}

// ───── Verificar si puede reproducirse otra ─────
async function checkPlaybackState(accessToken: string): Promise<boolean> {
  try {
    const res = await axios.get(`${SPOTIFY_BASE_URL}/me/player`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const isPlaying = res.data?.is_playing;
    const progress = res.data?.progress_ms;
    const duration = res.data?.item?.duration_ms;

    const remaining = duration - progress;

    return !isPlaying || remaining < SAFETY_BUFFER_MS;
  } catch (err) {
    console.warn('[Sync] Error checking playback state. Assuming playback is off.');
    return true;
  }
}

// ───── Leer la cola de Firebase ─────────────────
async function processQueue(db: admin.database.Database): Promise<any | null> {
  const snap = await db.ref('/queue').once('value');
  const data = snap.val() || {};

  const songs = Object.entries(data).map(([id, val]: any) => ({
    id,
    ...val,
    order: val.order ?? val.timestampAdded ?? 0,
  }));

  songs.sort((a, b) => a.order - b.order);

  return songs[0] || null;
}

// ───── Enviar canción a reproducir ──────────────
async function playTrack(accessToken: string, deviceId: string, spotifyTrackId: string) {
  const url = `${SPOTIFY_BASE_URL}/me/player/play?device_id=${deviceId}`;
  const headers = { Authorization: `Bearer ${accessToken}` };
  const body = { uris: [`spotify:track:${spotifyTrackId}`] };

  await callSpotifyApiWithRetry(url, headers, 'put', body);
}

// ───── Ruta principal ───────────────────────────
export async function POST() {
  const db = getFirebaseApp().database();

  try {
    console.log('[Sync] Iniciando sincronización...');

    // 1. Leer tokens
    const tokens = await db.ref('/admin/spotify/tokens').once('value').then((s) => s.val());
    if (!tokens) {
      console.error('[Sync] No hay tokens en Firebase.');
      return NextResponse.json({ error: 'No Spotify tokens' }, { status: 400 });
    }

    // 2. Obtener access_token y device_id
    const [accessToken, deviceId] = await handleTokenAndDevice(tokens);
    if (!accessToken || !deviceId) {
      console.error('[Sync] No se pudo obtener accessToken o deviceId');
      return NextResponse.json({ error: 'Token o dispositivo inválido' }, { status: 500 });
    }

    console.log(`[Sync] Token y device listos: ${deviceId.substring(0, 8)}...`);

    // 3. Verificar estado actual de reproducción
    const shouldSync = await checkPlaybackState(accessToken);
    if (!shouldSync) {
      console.log('[Sync] Spotify ya está reproduciendo. Abortando.');
      return NextResponse.json({ message: 'Playback in progress, skipping sync' });
    }

    // 4. Leer la siguiente canción de la cola
    const song = await processQueue(db);
    if (!song) {
      console.log('[Sync] La cola está vacía.');
      return NextResponse.json({ message: 'Empty queue' });
    }

    console.log(`[Sync] Próxima canción: ${song.title} (${song.spotifyTrackId})`);

    // 5. Reproducir canción
    await playTrack(accessToken, deviceId, song.spotifyTrackId);
    console.log(`[Sync] Reproduciendo: ${song.spotifyTrackId}`);

    // 6. Eliminar canción de la cola
    await db.ref(`/queue/${song.id}`).remove();
    console.log(`[Sync] Canción eliminada de la cola: ${song.id}`);

    return NextResponse.json({ success: true, played: song });
  } catch (err: any) {
    console.error('[Sync] Error inesperado:', err);
    return NextResponse.json({ error: 'Internal error', details: err.message }, { status: 500 });
  }
}
