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
    } // Fin de la condición crítica del tiempo restante

    // Procedemos a añadir la canción a la cola si queda poco tiempo
    const trackUri = `spotify:track:${nextQueueSong.spotifyTrackId}`;
    const firebaseQueuePath = `/queue/${nextQueueSong.id}`; // Ruta a la canción en la cola principal de Firebase
    const enqueuedKeyPath = `/admin/spotify/enqueuedTracks/${nextQueueSong.id}`; // Ruta para marcar la canción como ya procesada/encolada

    // VERIFICACIÓN 1: ¿La canción todavía existe en la cola de Firebase?
    // Podría haber sido eliminada por otro proceso entre que se obtuvo y ahora.
    const songStillInQueueSnap = await db.ref(firebaseQueuePath).once('value');
    if (!songStillInQueueSnap.exists()) {
      console.log(`DEBUG: Canción ${nextQueueSong.id} ya no está en la cola Firebase (/queue). Posiblemente procesada por otro medio o eliminada.`);
      // Opcional: limpiar la entrada en enqueuedTracks si existiera, para evitar confusiones futuras.
      await db.ref(enqueuedKeyPath).remove();
      return NextResponse.json({ message: 'Track no longer in Firebase queue. Assumed processed or removed.' });
    }

    // VERIFICACIÓN 2: ¿Se marcó esta canción como encolada recientemente Y AÚN SIGUE EN LA COLA?
    const alreadyEnqueuedSnap = await db.ref(enqueuedKeyPath).once('value');
    if (alreadyEnqueuedSnap.exists()) {
      const timeSinceEnqueued = Date.now() - alreadyEnqueuedSnap.val().timestamp;
      // Si se marcó como encolada hace menos de X tiempo (ej. 60s) Y la canción AÚN está en firebaseQueuePath.
      if (timeSinceEnqueued < 60_000) { // 60 segundos
        console.log(`DEBUG: Canción ${nextQueueSong.id} fue marcada en enqueuedTracks hace ${timeSinceEnqueued} ms y AÚN está en Firebase /queue. Se omite este intento de sincronización para evitar duplicados o bucles rápidos.`);
        return NextResponse.json({ message: 'Track was marked enqueued recently and is still in Firebase queue. Skipping this sync attempt.' });
      } else {
        // La marca es antigua, pero la canción sigue en la cola. Esto indica un posible fallo anterior.
        console.warn(`DEBUG: Entrada en enqueuedTracks para ${nextQueueSong.id} es antigua (hace ${timeSinceEnqueued}ms) y la canción AÚN está en Firebase /queue. Se intentará re-procesar.`);
        // Se permite continuar para reintentar el proceso de encolar y eliminar.
      }
    }

    // INICIO DEL BLOQUE PRINCIPAL DE OPERACIONES (SPOTIFY Y FIREBASE)
    try {
      // PASO 1: Intentar añadir la canción a la cola de Spotify.
      await enqueueTrack(accessToken, trackUri, deviceId);
      console.log(`DEBUG: Canción ${nextQueueSong.id} (${trackUri}) añadida exitosamente a la cola de Spotify.`);

      // PASO 2: Si la adición a Spotify fue exitosa, intentar eliminarla de la cola de Firebase.
      try {
        await db.ref(firebaseQueuePath).remove();
        console.log(`DEBUG: Canción ${nextQueueSong.id} eliminada de Firebase /queue.`);

        // PASO 3: Si la eliminación de Firebase fue exitosa, marcarla en enqueuedTracks.
        // Esto previene que, si hay llamadas muy rápidas a sync, se intente procesar múltiples veces.
        await db.ref(enqueuedKeyPath).set({
          timestamp: Date.now(),
          trackId: nextQueueSong.id, // ID de Firebase
          spotifyTrackId: nextQueueSong.spotifyTrackId, // ID de Spotify
          title: nextQueueSong.title || "N/A" // Opcional: guardar más info para debugging
        });
        console.log(`DEBUG: Canción ${nextQueueSong.id} marcada en enqueuedTracks.`);

        // PASO 4: Actualizar el ID de la canción que ahora se considera "sonando" o "siguiente en sonar".
        await db.ref('/admin/spotify/nowPlayingId').set({
          id: nextQueueSong.spotifyTrackId,
          title: nextQueueSong.title || "N/A",
          artist: nextQueueSong.artist || "N/A",
          source: 'sync-route', // Para saber qué proceso actualizó esto
          timestamp: Date.now(),
        });
        console.log(`DEBUG: Actualizado nowPlayingId en Firebase a ${nextQueueSong.spotifyTrackId}.`);

        return NextResponse.json({ success: true, enqueued: nextQueueSong });

      } catch (firebaseRemoveError: any) {
        // ERROR CRÍTICO: La canción se añadió a Spotify, pero NO PUDO SER ELIMINADA de Firebase /queue.
        console.error(`CRITICAL_ERROR: Falló la eliminación de ${nextQueueSong.id} de Firebase /queue DESPUÉS de añadirla a Spotify. Error: ${firebaseRemoveError.message}`);
        await logError(`CRITICAL_ERROR: Firebase remove failed for ${nextQueueSong.id} (SpotifyID: ${nextQueueSong.spotifyTrackId}) after successful Spotify add. Firebase Error: ${firebaseRemoveError.message}`);

        // IMPORTANTE: NO establecer enqueuedKeyPath aquí. Si la eliminación de Firebase falla,
        // queremos que el sistema reintente todo el proceso para esta canción en la próxima ejecución de sync,
        // incluyendo el intento de añadir a Spotify (Spotify suele ser idempotente y no duplicará la canción en su cola si ya está).
        // Devolver un error específico para indicar esta situación.
        return NextResponse.json({ 
          error: `Song added to Spotify but FAILED to remove from Firebase /queue. Manual check may be needed. Firebase error: ${firebaseRemoveError.message}` 
        }, { status: 500 });
      }

    } catch (spotifyOrPrereqError: any) {
      // Captura errores de: refreshTokenIfNeeded, getActiveDeviceId, getPlaybackState, o enqueueTrack.
      const isAxiosErr = spotifyOrPrereqError.isAxiosError;
      const spotifyErrMsg = isAxiosErr ? spotifyOrPrereqError.response?.data?.error?.message : spotifyOrPrereqError.message;
      const status = isAxiosErr ? spotifyOrPrereqError.response?.status : 500;

      const detailedMessage = `Error during Spotify operation or prerequisite for song ID ${nextQueueSong?.id || '(no song loaded yet)'}. Error: ${spotifyErrMsg || 'Unknown error type'}`;
      console.error(`DEBUG: ${detailedMessage}`, spotifyOrPrereqError);
      await logError(detailedMessage);

      return NextResponse.json({ error: `Spotify operation error: ${spotifyErrMsg || 'desconocido'}` }, { status: status || 500 });
    }
    // FIN DEL BLOQUE PRINCIPAL DE OPERACIONES

  } catch (err: any) {
    await logError(err.response?.data || err.message || 'Unknown error in sync');
    console.error("DEBUG: Error en sincronización:", err);
    return NextResponse.json({ error: 'Error: ' + (err?.message || 'desconocido') }, { status: 500 });
  }
}