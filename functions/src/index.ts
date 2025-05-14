/* eslint-disable object-curly-spacing, quote-props, max-len */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as path from "path";
import axios from "axios";
import cors from "cors";
import * as fs from "fs";
import { URLSearchParams } from 'url';

// Ruta absoluta al archivo de credenciales
const serviceAccountPath = path.join(__dirname, "../firebase-service-account.json");

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    fs.readFileSync(serviceAccountPath, "utf8")
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://barjukebox-default-rtdb.europe-west1.firebasedatabase.app",
  });
}

const corsHandler = cors({ origin: true });

// Función auxiliar para obtener token de acceso válido
async function getValidAccessToken(): Promise<string> {
  console.log('getValidAccessToken: Starting token validation check.');
  const db = admin.database();
  console.log('getValidAccessToken: Reading Spotify tokens from /admin/spotify/tokens.');
  const snapshot = await db.ref('/admin/spotify/tokens').once('value');
  const tokens = snapshot.val();
  console.log('getValidAccessToken: Current tokens data:', tokens);
  if (!tokens || !tokens.refreshToken) {
    throw new Error('No Spotify tokens found in database.');
  }

  let accessToken = tokens.accessToken;
  const now = Date.now();
  console.log('getValidAccessToken: Current time:', now, 'Expires At:', tokens.expiresAt);
  if (!tokens.expiresAt || now >= tokens.expiresAt - 60000) {
    console.log('Spotify access token expired or expiring soon, refreshing...');
    const spotifySecrets = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../spotify-credentials.json"), "utf8").replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "")
    );
    const clientId = spotifySecrets.client_id;
    const clientSecret = spotifySecrets.client_secret;

    const refreshRes = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
      }
    ).catch(err => {
      console.error("getValidAccessToken: Error refreshing token:", err.message, err.stack);
      throw err;
    });

    accessToken = refreshRes.data.access_token;
    const expiresIn = refreshRes.data.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    console.log('getValidAccessToken: Updating tokens in database.');
    await db.ref('/admin/spotify/tokens').update({
      accessToken,
      expiresAt,
    });
    console.log('Spotify access token refreshed and saved.');
  }

  console.log('getValidAccessToken: Returning valid access token.');
  return accessToken;
}

// Función auxiliar para obtener dispositivo activo
async function getActiveDeviceId(accessToken: string): Promise<string> {
  console.log('getActiveDeviceId: Starting to find active device.');
  console.log('getActiveDeviceId: Calling Spotify API to list devices.');
  const res = await axios.get('https://api.spotify.com/v1/me/player/devices', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const device = res.data.devices.find((d: any) => d.is_active) || res.data.devices[0];
  if (!device?.id) {
    throw new Error('No active or available Spotify devices found.');
  }
  console.log('getActiveDeviceId: Found active device:', device.id);
  return device.id;
}

async function playTrack(accessToken: string, deviceId: string, trackId: string): Promise<void> {
  console.log(`playTrack: Attempting to play track ${trackId} on device ${deviceId}.`);
  try {
    console.log("playTrack: Calling Spotify API /me/player/play.");
    const url = `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`;
    const headers = { Authorization: `Bearer ${accessToken}` };
    const body = { uris: [`spotify:track:${trackId}`] };
    await axios.put(url, body, { headers });
    console.log(`Attempted to play track ${trackId} on device ${deviceId}`);
  } catch (error: any) {
    console.error("❌ Error in playTrack:", error.message, error.stack);
    throw error;
  }
}

async function getNextTrack(db: admin.database.Database): Promise<any | null> {
  console.log('getNextTrack: Starting to get next track from queue.');
  const snap = await db.ref('/queue').once('value');
  console.log('getNextTrack: Read queue data from /queue.');
  const queue = snap.val() || {};

  const songs = Object.entries(queue).map(([id, val]: [string, any]) => ({
    id,
    ...val,
    order: val.order ?? val.timestampAdded ?? 0,
  }));

  songs.sort((a, b) => a.order - b.order);
  console.log('getNextTrack: Sorted queue:', songs.map((s: any) => s.title));
  return songs[0] || null;
}

async function getSpotifyPlayerState(accessToken: string): Promise<any> {
  console.log('getSpotifyPlayerState: Starting to get player state.');
  try {
    console.log('getSpotifyPlayerState: Calling Spotify API /me/player/currently-playing.');
    const playerRes = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: (status) => status === 200 || status === 204 || status === 404,
    });

    if (playerRes.status === 204 || !playerRes.data) {
      return { isPlaying: false, progress_ms: 0, duration_ms: 0, trackId: null };
    }

    const data = playerRes.data;
    const item = data.item;

    return {
      isPlaying: data.is_playing,
      progress_ms: data.progress_ms,
      duration_ms: item?.duration_ms ?? 0,
      trackId: item?.id ?? null,
      isBuffering: data.is_buffering ?? false,
    };

  } catch (error: any) {
    console.error("getSpotifyPlayerState: Error fetching player state:", error.message, error.stack);
    if (error.response?.status === 404) {
      console.log("Spotify player state: No active device or player not found.");
      return { isPlaying: false, progress_ms: 0, duration_ms: 0, trackId: null };
    }
    console.error("Error getting Spotify player state:", error.message || error);
    throw error;
  }
}

import { onSchedule } from "firebase-functions/v2/scheduler";

export const checkAndPlayNextTrack = onSchedule({ schedule: "every 8 seconds", timeoutSeconds: 60 }, async (context) => {
  console.log("Running checkAndPlayNextTrack...");
  console.log("checkAndPlayNextTrack: Context:", JSON.stringify(context));
  const db = admin.database();

  try {
    const accessToken = await getValidAccessToken();
    console.log("checkAndPlayNextTrack: Got valid access token.");
    const deviceId = await getActiveDeviceId(accessToken);
    console.log("checkAndPlayNextTrack: Got active device ID:", deviceId);
    const playerState = await getSpotifyPlayerState(accessToken);
    console.log("checkAndPlayNextTrack: Got Spotify player state:", playerState);
    const nextSong = await getNextTrack(db);
    console.log("checkAndPlayNextTrack: Got next song from queue:", nextSong);
    if (!nextSong) {
      console.log("🛑 No hay canciones en la cola.");
      return;
    }

    const remainingMs = playerState.duration_ms - playerState.progress_ms;
    const estimatedLatency = 300; // Ajusta este valor según pruebas reales

    if (remainingMs <= 3000) {
      const delay = remainingMs - estimatedLatency;
      console.log(`⏱️ Song ending soon. Remaining: ${remainingMs}ms. Delay before play: ${delay}ms`);

      if (delay > 0) {
        setTimeout(async () => {
          try {
            console.log("⏭️ (Delayed) Intentando reproducir:", nextSong.title);
            await playTrack(accessToken, deviceId, nextSong.spotifyTrackId);
            await db.ref(`/queue/${nextSong.id}`).remove();
            console.log(`✅ (Delayed) Canción reproducida y eliminada de la cola.`);
          } catch (err: any) {
            console.error("❌ Error en reproducción retrasada:", err.message);
          }
        }, delay);
      } else {
        console.log("⚠️ Delay negativo, reproduciendo inmediatamente.");
        await playTrack(accessToken, deviceId, nextSong.spotifyTrackId);
        await db.ref(`/queue/${nextSong.id}`).remove();
        console.log(`✅ (Immediate) Canción reproducida y eliminada de la cola.`);
      }
      return; // Evita que el resto de la función continúe
    } else {
      console.log(`✅ Canción actual con tiempo restante suficiente: ${remainingMs}ms`);
    }
  } catch (error: any) {
    console.error("❌ Error in checkAndPlayNextTrack:", error.message, error.stack);
    throw error;
  }
});

export const searchSpotify = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    console.log("searchSpotify: Request method:", req.method, "Query parameters:", req.query);
    try {
      if (req.method !== "GET") {
        res.status(405).json({ error: "Method Not Allowed" });
        console.log("searchSpotify: Method Not Allowed.");
        return;
      }

      const query = req.query.q as string;
      if (!query) {
        res.status(400).json({ error: "Missing parameter 'q'" });
        console.log("searchSpotify: Missing query parameter 'q'.");
        return;
      }

      const accessToken = await getValidAccessToken();
      console.log("searchSpotify: Got valid access token for search.");
      const snap = await admin.database().ref("/config").once("value");
      const config = snap.val() || {};
      const mode = config.searchMode || "all";
      const playlistId = config.playlistId as string;

      console.log("searchSpotify: Search mode:", mode, "Playlist ID:", playlistId);
      let tracks: any[] = [];
      if (mode === "playlist") {
        console.log("searchSpotify: Searching within playlist.");
        if (!playlistId) {
          res.status(400).json({ error: "Playlist ID not configured" });
          console.log("searchSpotify: Playlist ID not configured.");
          return;
        }

        try {
          const response = await axios.get(
            `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              params: {
                fields: "items(track(id,name,artists(name),album(name),uri,preview_url))",
                limit: 100,
              },
            }
          );

          console.log('searchSpotify: Spotify Playlist Search API Response Status:', response.status, 'Data:', response.data);
          const qLower = query.toLowerCase();
          tracks = (response.data.items || [])
            .map((i: any) => i.track)
            .filter((t: any) =>
              t.name.toLowerCase().includes(qLower) ||
              t.artists.some((a: any) => a.name.toLowerCase().includes(qLower))
            );
        } catch (error: any) {
          console.error("❌ Error fetching playlist tracks:", error.message, error.stack);
          throw error;
        }
      } else {
        console.log("searchSpotify: Performing general Spotify search.");
        const response = await axios.get("https://api.spotify.com/v1/search", {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { q: query, type: "track", limit: 20 },
        });

        tracks = response.data?.tracks?.items || [];
      }

      if (!Array.isArray(tracks)) {
        console.warn("searchSpotify: ⚠️ Spotify API response for tracks was not an array, forcing empty array.");
        console.log("searchSpotify: Received non-array response:", tracks);
        tracks = [];
      }

      const results = tracks.map((t: any) => ({
        id: t.id,
        name: t.name,
        artists: t.artists.map((a: any) => a.name),
        album: t.album.name,
        uri: t.uri,
        preview_url: t.preview_url,
      })).filter((t: any) => t.id !== null); // Filter out any tracks without an ID
      console.log("searchSpotify: Processed search results count:", results.length);
      console.log("searchSpotify: Sending search results response.");
      return res.status(200).json({ results });

    } catch (error: any) {
      console.error("❌ Error en searchSpotify:", error.message, error.stack);
      console.log("searchSpotify: Sending error response.");
      return res.status(500).json({ error: error.message || "Internal Server Error", stack: error.stack });
    }
  });
});