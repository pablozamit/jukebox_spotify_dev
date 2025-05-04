export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios, { AxiosError } from 'axios';
import * as admin from 'firebase-admin';

// Configuración optimizada
const SPOTIFY_API_TIMEOUT = 5000; // 5s timeout para llamadas a Spotify
const SAFETY_BUFFER_MS = 3000; // 3s buffer para transiciones
const SPOTIFY_BASE_URL = 'https://api.spotify.com/v1';
const RETRY_DELAY_MS = 30000;
const MAX_RETRIES = 3;

// Inicialización eficiente de Firebase
const getFirebaseApp = () => {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
        });
    }
    return admin.app();
};

// Cliente HTTP reutilizable con timeout
const httpClient = axios.create({
    timeout: SPOTIFY_API_TIMEOUT,
});

// Función wrapper para llamadas a la API de Spotify con reintento
async function callSpotifyApiWithRetry(url: string, headers: any, method: 'get' | 'post' | 'put' | 'delete', retryCount = 0): Promise<any> {
    try {
        console.log(`[Spotify API] Attempt ${retryCount + 1}: ${method.toUpperCase()} ${url}`);
        const response = await httpClient({ method, url, headers });
        return response.data;
    } catch (error: any) {
        const axiosError = error as AxiosError;
        console.error(`[Spotify API] Error on attempt ${retryCount + 1} for ${method.toUpperCase()} ${url}:`, axiosError.message);

        if (retryCount < MAX_RETRIES && axiosError.response?.status !== 401) { // No reintentar en caso de token inválido (401)
            console.log(`[Spotify API] Retrying in ${RETRY_DELAY_MS / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            return callSpotifyApiWithRetry(url, headers, method, retryCount + 1);
        }
        throw error;
    }
}

export async function POST() {
    const db = getFirebaseApp().database();

    try {
        console.log('[Sync] Starting sync process.');

        // 1. Manejo de tokens
        const tokens = await db.ref('/admin/spotify/tokens').once('value').then(s => s.val());
        if (!tokens) {
            console.error('[Sync] No Spotify tokens found.');
            return NextResponse.json({ error: 'No Spotify tokens' }, { status: 400 });
        }

        // 2. Refresco de token y obtención de dispositivo
        const [accessToken, deviceId] = await handleTokenAndDevice(tokens);
        if (!accessToken || !deviceId) {
            console.error('[Sync] Could not retrieve access token or device ID.');
            return NextResponse.json({ error: 'Failed to get access token or device' }, { status: 500 });
        }
        console.log(`[Sync] Retrieved access token and device ID: ${deviceId.substring(0, 8)}...`);

        // 3. Verificación de estado de reproducción
        const shouldProceed = await checkPlaybackState(accessToken);
        if (!shouldProceed) {
            console.log('[Sync] Playback in progress or paused, skipping sync.');
            return NextResponse.json({ message: 'Playback in progress or paused, skipping sync' });
        }
        console.log('[Sync] Proceeding with sync.');

        // 4. Procesamiento de la cola
        const topSong = await processQueue(db);
        if (!topSong) {
            console.log('[Sync] Queue is empty.');
            return NextResponse.json({ message: 'Empty queue' });
        }
        console.log(`[Sync] Next song in queue: ${topSong.spotifyTrackId}`);

        // 5. Reproducción de la canción
        await playTrack(accessToken, deviceId, topSong.spotifyTrackId);
        console.log(`[Sync] Started playing track: ${topSong.spotifyTrackId} on device ${deviceId.substring(0, 8)}...`);

        // 6. Actualización de la cola
        await db.ref(`/queue/${topSong.id}`).remove();
        console.log(`[Sync] Removed track ${topSong.id} from the queue.`);

        return NextResponse.json({ success: true, played: topSong });

    } catch (error: any) {
        console.error('[Sync] Sync error:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: error.message },
            { status: 500 }
        );
    }
}

// --- Funciones auxiliares optimizadas ---

async function handleTokenAndDevice(tokens: any): Promise<[string | null, string | null]> {
    let accessToken = tokens.accessToken;

    // Refrescar token solo si está expirado (con margen de 1 minuto)
    if (Date.now() >= tokens.expiresAt - 60000) {
        console.log('[Token Refresh] Access token is expired or about to expire, refreshing...');
        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokens.refreshToken,
        });

        const auth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID!}:${process.env.SPOTIFY_CLIENT_SECRET!}`).toString('base64');

        try {
            const data = await callSpotifyApiWithRetry(
                'https://accounts.spotify.com/api/token',
                { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${auth}` },
                'post',
                MAX_RETRIES
            );
            accessToken = data.access_token;
            const newExpiry = Date.now() + data.expires_in * 1000;

            await admin.database().ref('/admin/spotify/tokens').update({
                accessToken,
                expiresAt: newExpiry,
            });
            console.log('[Token Refresh] Access token refreshed successfully.');
        } catch (error) {
            console.error('[Token Refresh] Error refreshing access token:', error);
            return [null, null];
        }
    }

    try {
        // Obtener dispositivo activo
        const devicesData = await callSpotifyApiWithRetry(
            `${SPOTIFY_BASE_URL}/me/player/devices`,
            { Authorization: `Bearer ${accessToken}` },
            'get',
            MAX_RETRIES
        );
        const activeDevice = devicesData.devices?.find((d: any) => d.is_active) ?? devicesData.devices?.[0];
        if (!activeDevice?.id) {
            console.warn('[Device Retrieval] No active device found, using first available or null.');
            return [accessToken, devicesData.devices?.[0]?.id || null];
        }
        console.log(`[Device Retrieval] Active device found: ${activeDevice.id.substring(0, 8)}...`);
        return [accessToken, activeDevice.id];
    } catch (error) {
        console.error('[Device Retrieval] Error retrieving devices:', error);
        return [accessToken, null];
    }
}

async function checkPlaybackState(accessToken: string): Promise<boolean> {
    try {
        const playbackInfo = await callSpotifyApiWithRetry(
            `${SPOTIFY_BASE_URL}/me/player`,
            { Authorization: `Bearer ${accessToken}` },
            'get',
            MAX_RETRIES
        );

        if (playbackInfo?.is_playing) {
            const progress = playbackInfo.progress_ms || 0;
            const duration = playbackInfo.item?.duration_ms || 0;
            const remainingTime = duration - progress;
            console.log(`[Playback Check] Currently playing: ${playbackInfo.item?.name}, Remaining: ${remainingTime / 1000}s`);
            return remainingTime <= SAFETY_BUFFER_MS;
        } else {
            console.log('[Playback Check] No active playback or playback is paused.');
            return true; // Si no está reproduciendo activamente, podemos proceder
        }
    } catch (error: any) {
        // Si no hay sesión activa, la API devuelve 204 sin contenido, lo cual axios puede manejar como error.
        // También pueden ocurrir otros errores de red o de la API.
        if (error.response?.status === 204) {
            console.log('[Playback Check] No active Spotify session.');
            return true;
        }
        console.warn('[Playback Check] Error checking playback state:', error.message);
        return true; // En caso de error, para evitar bloqueos, permitimos el intento de sincronización.
                      // Un manejo más sofisticado podría ser necesario.
    }
}

async function processQueue(db: admin.database.Database): Promise<any> {
    const snapshot = await db.ref('/queue').once('value');
    const queue = snapshot.val() || {};

    const sortedQueue = Object.entries(queue)
        .map(([id, entry]: [string, any]) => ({
            id,
            votes: entry.votes || 0,
            order: entry.order || 0,
            spotifyTrackId: entry.spotifyTrackId,
        }))
        .sort((a, b) =>
            b.votes - a.votes ||
            a.order - b.order
        );

    const topSong = sortedQueue[0];
    if (topSong) {
        console.log(`[Queue] Top song: ${topSong.spotifyTrackId} (Votes: ${topSong.votes}, Order: ${topSong.order})`);
    } else {
        console.log('[Queue] Queue is empty.');
    }
    return topSong;
}

async function playTrack(accessToken: string, deviceId: string, trackId: string) {
  try {
      await callSpotifyApiWithRetry(
          `${SPOTIFY_BASE_URL}/me/player/play?device_id=${deviceId}`,
          {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
          },
          'put'
          // No necesitamos pasar MAX_RETRIES ni RETRY_DELAY_MS aquí, ya tienen valores por defecto
      );
      console.log(`[Playback] Playback started for track: spotify:track:${trackId} on device ${deviceId.substring(0, 8)}...`);
  } catch (error) {
      console.error('[Playback] Error starting playback:', error);
      throw error; // Re-lanzamos el error para que el bloque catch principal lo maneje
  }
}