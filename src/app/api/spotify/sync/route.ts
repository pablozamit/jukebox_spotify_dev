export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';
import * as admin from 'firebase-admin';

const SPOTIFY_BASE_URL = 'https://api.spotify.com/v1';
const SAFETY_BUFFER_MS = 1000; // 1 second
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
  } else if (res.status !== 200) {
    // Handle other non-200 status codes
    throw new Error(`Spotify API returned status ${res.status} for playback state`);
  }

  return res.data;
}

async function getRandomTrackFromPlaylist(accessToken: string, deviceId: string, playlistId: string): Promise<any | null> {
  try {
    const allTracks: any[] = [];
    let url: string | null = `${SPOTIFY_BASE_URL}/playlists/${playlistId}/tracks?limit=50`;

    while (url) {
      try {
        const response: any = await httpClient.get(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });



        if (response.status === 200) {
          allTracks.push(...response.data.items.map((item: any) => item.track).filter(Boolean)); // Add track objects, filter out nulls
          url = response.data.next;
        } else {
          console.error(`Error fetching playlist tracks: Status ${response.status}`);
          url = null; // Stop the loop on error
        }
      } catch (error) {
        console.error("Error during fetching playlist tracks:", error);
        url = null; // Stop the loop on error
      }
    }

    if (allTracks.length === 0) {
      return null; // Playlist is empty or could not be loaded
    }

    const randomIndex = Math.floor(Math.random() * allTracks.length);
    return allTracks[randomIndex];
  } catch (error: any) {
    console.error("Error in getRandomTrackFromPlaylist:", error);
    return null; // Return null on error
  }
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

    const playbackState = await getPlaybackState(accessToken);
    console.error("DEBUG: Playback State:", JSON.stringify(playbackState, null, 2));

    // If Spotify is paused, and a track is loaded, assume intentional pause and do nothing.
    if (playbackState && playbackState.item && !playbackState.is_playing) {
      console.error("DEBUG: Spotify is paused, skipping sync.");
      return NextResponse.json({ message: 'Spotify is paused, no sync needed.' });
    }

    // Get the next track from the queue
    const nextQueueSong = await getNextTrack(db);
    console.error("DEBUG: Primera cancion de la cola:", nextQueueSong?.spotifyTrackId);

    if (!nextQueueSong) { // If the queue is empty
      console.error("DEBUG: Cola vacia. Verificando configuracion de playlist.");
      const configSnap = await db.ref('/config').once('value'); // Fetch config here
      const config = configSnap.val() || {};

      if (config.searchMode === 'playlist' && config.playlistId) { // If in playlist mode and playlistId is set
        console.error(`DEBUG: Modo playlist. Intentando reproducir aleatoria de playlist: ${config.playlistId}`);
        const randomSong = await getRandomTrackFromPlaylist(accessToken, deviceId, config.playlistId);

        if (randomSong) {
          console.error("DEBUG: Cancion aleatoria obtenida. Intentando reproducir:", randomSong.id);
          await playTrack(accessToken, deviceId, randomSong.id);
          console.error("DEBUG: Llamada a playTrack con cancion aleatoria completada.");
          return NextResponse.json({ success: true, playedRandom: randomSong });
        } else {
          console.error("DEBUG: No se pudo obtener cancion aleatoria de la playlist.");
          return NextResponse.json({ message: 'Queue empty, playlist mode, but could not get random track from playlist.' });
        }
      } else { // If queue is empty but NOT in playlist mode
        console.error("DEBUG: Cola vacia. Modo no es playlist o no hay playlistId. No se reproduce nada.");
        return NextResponse.json({ message: 'Queue is empty' });
      }
    } else { // If there are songs in the queue
      const isPlaying = playbackState?.is_playing;
      const currentTrackId = playbackState?.item?.id;

      // Calculate time remaining of the current track in milliseconds
      const progressMs = playbackState?.progress_ms || 0;
      const durationMs = playbackState?.item?.duration_ms || 0;
      const timeRemainingMs = durationMs - progressMs;

      console.error(`DEBUG: isPlaying: ${isPlaying}, currentTrackId: ${currentTrackId}, timeRemainingMs: ${timeRemainingMs}`);
      console.error(`DEBUG: Siguiente cancion ID en cola: ${nextQueueSong.spotifyTrackId}`);

      // Determine if we need to play the next track from the queue.
      // This happens if:
      // 1. Spotify is not playing anything (playbackState?.item == null)
      // 2. Spotify is playing a different track than the one at the top of the queue (currentTrackId !== nextQueueSong?.spotifyTrackId)
      // 3. Spotify is playing the correct track, but it's near its end (currentTrackId === nextQueueSong?.spotifyTrackId && timeRemainingMs < SAFETY_BUFFER_MS)
      if (playbackState?.item == null || currentTrackId !== nextQueueSong?.spotifyTrackId || (currentTrackId === nextQueueSong?.spotifyTrackId && timeRemainingMs < SAFETY_BUFFER_MS)) {
        console.error("DEBUG: Condicion de reproduccion cumplida para la cola. Intentando reproducir la siguiente:", nextQueueSong.spotifyTrackId);
        await playTrack(accessToken, deviceId, nextQueueSong.spotifyTrackId);
        console.error("DEBUG: Llamada a playTrack completada. Eliminando cancion de la cola:", nextQueueSong.id);
        await db.ref(`/queue/${nextQueueSong.id}`).remove();
        console.error("DEBUG: Cancion eliminada de la cola.");

        return NextResponse.json({ success: true, played: nextQueueSong });
      } else {
        // If we reach here, Spotify is playing the correct song and it's not near the end, and it's not paused intentionally.
        console.error("DEBUG: Spotify esta reproduciendo la cancion correcta de la cola y no necesita avance.");
        return NextResponse.json({ message: 'Spotify is playing the correct track from queue and does not need to advance.' });
      }
    }
  } catch (err: any) {
    await logError(err.response?.data || err.message || 'Unknown error in sync');
    console.error("DEBUG: Error en sincronizacion:", err);
    if (err.response?.data) {
      console.error("DEBUG: Detalles del error de Spotify:", err.response.data);
    }
    return NextResponse.json({ error: 'Error: ' + (err?.message || 'desconocido') }, { status: 500 });
  }
}