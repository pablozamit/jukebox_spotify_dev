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
    console.log('[getFirebaseApp] Initializing Firebase App...');
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL
,
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
  console.log(`[callSpotifyApiWithRetry] Attempt ${retryCount + 1}: ${method.toUpperCase()} ${url}`);
  try {
    const res = await httpClient({
      url,
      method,
      headers,
      data: body,
    });
    console.log(`[callSpotifyApiWithRetry] Attempt ${retryCount + 1} success: ${method.toUpperCase()} ${url}`, res);
    return res.data;
  } catch (error: any) {
    const axiosError = error as AxiosError;
    console.error(`[callSpotifyApiWithRetry] Error on attempt ${retryCount + 1}: ${axiosError.message}`);
    console.error(`[callSpotifyApiWithRetry] Error details:`, axiosError.response?.data);

    if (axiosError.response) {
      if (axiosError.response.data && (axiosError.response.data as any).error) {
        throw new Error(`Spotify API Error: ${(axiosError.response.data as any).error.message || 'Unknown error'}`);
      } else if (axiosError.response.status !== 401) {
        if (retryCount < MAX_RETRIES) {
          console.warn(`[callSpotifyApiWithRetry] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await new Promise((res) => setTimeout(res, RETRY_DELAY_MS));
          return callSpotifyApiWithRetry(url, headers, method, body, retryCount + 1);
        }
      }
    }

    throw axiosError;
  }
}

// ───── Refrescar token y obtener device ─────────
async function handleTokenAndDevice(tokens: any): Promise<[string, string]> {
  console.log('[handleTokenAndDevice] Starting handleTokenAndDevice...');
  try {
    console.log('[handleTokenAndDevice] Tokens received:', tokens);

    // Refrescar access_token
    console.log('[handleTokenAndDevice] Attempting to refresh access token...');
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

    if (refreshRes.data && (refreshRes.data as any).error) {
      throw new Error(`Error refreshing token: ${(refreshRes.data as any).error}`);
    }

    console.log('[handleTokenAndDevice] Token refresh response:', refreshRes);

    const accessToken = refreshRes.data.access_token;
    console.log('[handleTokenAndDevice] New access token:', accessToken);

    // Obtener device activo
    console.log('[handleTokenAndDevice] Attempting to get active device...');
    const deviceRes = await axios.get(`${SPOTIFY_BASE_URL}/me/player/devices`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    console.log('[handleTokenAndDevice] Get active device response:', deviceRes);

    if (deviceRes.data && (deviceRes.data as any).error) {
      throw new Error(`Error getting device: ${(deviceRes.data as any).error}`);
    }

    const device = deviceRes.data.devices.find((d: any) => d.is_active) || deviceRes.data.devices[0];
    console.log('[handleTokenAndDevice] Active device found:', device);

    if (!device?.id) throw new Error('No active Spotify devices found');
    console.log('[handleTokenAndDevice] handleTokenAndDevice finished successfully.');
    return [accessToken, device.id];
  } catch (error: any) {
    console.error('[handleTokenAndDevice] Error in handleTokenAndDevice:', error);
    console.error('[handleTokenAndDevice] Error details:', error.response?.data);
    throw new Error(`Error in handleTokenAndDevice: ${error.message}`);
  }
}

// ───── Verificar si puede reproducirse otra ─────
async function checkPlaybackState(accessToken: string): Promise<boolean> {
  try {
    const res = await axios.get(`${SPOTIFY_BASE_URL}/me/player`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.data && (res.data as any).error) {
      throw new Error(`Error in checkPlaybackState: ${(res.data as any).error}`);
    }

    const isPlaying = res.data?.is_playing;
    const progress = res.data?.progress_ms;
    const duration = res.data?.item?.duration_ms;

    const remaining = duration - progress;
    return !isPlaying || remaining < SAFETY_BUFFER_MS;
  } catch (error: any) {
    console.error('[checkPlaybackState] Error checking playback state:', error);
    console.error('[checkPlaybackState] Error details:', error.response?.data);
    throw new Error(`Error in checkPlaybackState: ${error.message}`);
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

    const tokens = await db.ref('/admin/spotify/tokens').once('value').then((s) => s.val());
    if (!tokens) {
      console.error('[Sync] No hay tokens en Firebase.');
      return NextResponse.json({ error: 'No Spotify tokens found. Connect first.' }, { status: 400 });
    }

    let accessToken = '';
    let deviceId = '';
    try {
      [accessToken, deviceId] = await handleTokenAndDevice(tokens);
    } catch (e: any) {
      console.error('[Sync] No se pudo obtener accessToken o deviceId', e.message);
      return NextResponse.json({ error: `Token o dispositivo inválido: ${e.message}` }, { status: 500 });
    }

    if (!accessToken || !deviceId) {
      console.error('[Sync] No se pudo obtener accessToken o deviceId');
      return NextResponse.json({ error: 'Token o dispositivo inválido' }, { status: 500 });
    }

    console.log(`[Sync] Token y device listos: ${deviceId.substring(0, 8)}...`);

    let shouldSync = false;
    try {
      shouldSync = await checkPlaybackState(accessToken);
    } catch (e: any) {
      console.error('[Sync] Error checking playback state.', e.message);
      return NextResponse.json({ error: `Error checking playback state: ${e.message}` }, { status: 500 });
    }

    if (!shouldSync) {
      console.log('[Sync] Spotify ya está reproduciendo. Abortando.');
      return NextResponse.json({ message: 'Playback in progress, skipping sync' });
    }

    let song = null;
    try {
      song = await processQueue(db);
    } catch (e: any) {
      console.error('[Sync] Error processQueue.', e.message);
      return NextResponse.json({ error: `Error processing queue: ${e.message}` }, { status: 500 });
    }

    if (!song) {
      console.log('[Sync] La cola está vacía.');
      return NextResponse.json({ message: 'Empty queue' });
    }

    console.log(`[Sync] Próxima canción: ${song.title} (${song.spotifyTrackId})`);

    try {
      await playTrack(accessToken, deviceId, song.spotifyTrackId);
    } catch (e: any) {
      console.error('[Sync] Error playTrack.', e.message);
      return NextResponse.json({ error: `Error playTrack: ${e.message}` }, { status: 500 });
    }

    console.log(`[Sync] Reproduciendo: ${song.spotifyTrackId}`);

    await db.ref(`/queue/${song.id}`).remove();
    console.log(`[Sync] Canción eliminada de la cola: ${song.id}`);

    return NextResponse.json({ success: true, played: song });
  } catch (err: any) {
    console.error('[Sync] Error inesperado:', err);
    return NextResponse.json({ error: `Internal error: ${err.message}` }, { status: 500 });
  }
}