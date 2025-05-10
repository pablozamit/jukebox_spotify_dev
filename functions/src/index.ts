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
  const db = admin.database();
  const snapshot = await db.ref('/admin/spotify/tokens').once('value');
  const tokens = snapshot.val();

  if (!tokens || !tokens.refreshToken) {
    throw new Error('No Spotify tokens found in database.');
  }

  let accessToken = tokens.accessToken;
  const now = Date.now();

  if (!tokens.expiresAt || now >= tokens.expiresAt - 60000) {
    console.log('Spotify access token expired or expiring soon, refreshing...');
    const cfg = functions.config().spotify;
    if (!cfg?.client_id || !cfg?.client_secret) {
      throw new Error('Spotify client credentials not configured in Firebase functions.');
    }

    const refreshRes = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64'),
        },
      }
    );

    accessToken = refreshRes.data.access_token;
    const expiresIn = refreshRes.data.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    await db.ref('/admin/spotify/tokens').update({
      accessToken: accessToken,
      expiresAt: expiresAt,
    });
    console.log('Spotify access token refreshed and saved.');
  }

  return accessToken;
}

// Función auxiliar para obtener dispositivo activo
async function getActiveDeviceId(accessToken: string): Promise<string> {
  const res = await axios.get('https://api.spotify.com/v1/me/player/devices', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const device = res.data.devices.find((d: any) => d.is_active) || res.data.devices[0];
  if (!device?.id) {
    throw new Error('No active or available Spotify devices found.');
  }
  return device.id;
}

// Función auxiliar para reproducir una canción
async function playTrack(accessToken: string, deviceId: string, trackId: string): Promise<void> {
  const url = `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`;
  const headers = { Authorization: `Bearer ${accessToken}` };
  const body = { uris: [`spotify:track:${trackId}`] };

  await axios.put(url, body, { headers });
  console.log(`Attempted to play track ${trackId} on device ${deviceId}`);
}

// Función auxiliar para obtener la siguiente canción de la cola
async function getNextTrack(db: admin.database.Database): Promise<any | null> {
  const snap = await db.ref('/queue').once('value');
  const queue = snap.val() || {};

  const songs = Object.entries(queue).map(([id, val]: any) => ({
    id,
    ...val,
    order: val.order ?? val.timestampAdded ?? 0,
  }));

  songs.sort((a, b) => a.order - b.order);
  return songs[0] || null;
}

// Función auxiliar para obtener estado del reproductor
async function getSpotifyPlayerState(accessToken: string): Promise<any> {
  try {
    const playerRes = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: (status) => status === 200 || status === 204,
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
    if (error.response?.status === 404) {
       console.log("Spotify player state: No active device or player not found.");
       return { isPlaying: false, progress_ms: 0, duration_ms: 0, trackId: null };
    }
    console.error("Error getting Spotify player state:", error.message || error);
    throw error;
  }
}

// (Eliminado por completo. Esta función ya no es necesaria)



// Cloud Function programada principal
import { onSchedule } from "firebase-functions/v2/scheduler";

export const checkAndPlayNextTrack = onSchedule("every 8 seconds", async (context) => {
  console.log("Running checkAndPlayNextTrack...");
  const db = admin.database();

  try {
    const accessToken = await getValidAccessToken();
    const deviceId = await getActiveDeviceId(accessToken);
    const playerState = await getSpotifyPlayerState(accessToken);
    const nextSong = await getNextTrack(db);

    if (!nextSong) {
      console.log("🛑 No hay canciones en la cola.");
      return;
    }

    const songEnded = !playerState.isPlaying ||
                      (playerState.trackId !== nextSong.spotifyTrackId);

    if (songEnded) {
      console.log("⏭️ Intentando reproducir:", nextSong.title);
      await playTrack(accessToken, deviceId, nextSong.spotifyTrackId);
      await new Promise(res => setTimeout(res, 3000));

      const newPlayerState = await getSpotifyPlayerState(accessToken);
      if (newPlayerState.isPlaying && newPlayerState.trackId === nextSong.spotifyTrackId) {
        console.log("✅ Confirmado: canción reproducida. Eliminando de la cola.");
        await db.ref(`/queue/${nextSong.id}`).remove();
      } else {
        console.warn("⚠️ No se pudo confirmar que la canción esté sonando.");
      }
    } else {
      const remaining = playerState.duration_ms - playerState.progress_ms;
      console.log(`🎵 Canción aún sonando (${remaining}ms restantes), sin acción.`);
    }

  } catch (err: any) {
    console.error("🔥 Error en checkAndPlayNextTrack:", err.message || err);
  }
});




// Función existente de búsqueda en Spotify
export const searchSpotify = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    const query = req.query.q as string;
    if (!query) {
      res.status(400).json({ error: "Missing parameter 'q'" });
      return;
    }

    const cfg = functions.config().spotify;
    if (!cfg?.client_id || !cfg?.client_secret) {
      res.status(500).json({ error: "Spotify config missing" });
      return;
    }

    let accessToken: string;
    try {
      const tokenRes = await axios.post(
        "https://accounts.spotify.com/api/token",
        new URLSearchParams({ grant_type: "client_credentials" }).toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(
              `${cfg.client_id}:${cfg.client_secret}`
            ).toString("base64")}`,
          },
        }
      );
      accessToken = tokenRes.data.access_token;
    } catch (err) {
      res.status(500).json({ error: "Failed to get Spotify token" });
      return;
    }

    const snap = await admin.database().ref("/config").once("value");
    const db = snap.val() || {};
    const mode = db.searchMode || "all";
    const pid = db.playlistId as string;

    let tracks: any[] = [];

    try {
      if (mode === "playlist") {
        if (!pid) {
          res.status(400).json({ error: "Playlist ID not configured" });
          return;
        }
        const plRes = await axios.get(
          `https://api.spotify.com/v1/playlists/${pid}/tracks`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: {
              fields: "items(track(id,name,artists(name),album(name),uri,preview_url))",
              limit: 100,
            },
          }
        );
        const ql = query.toLowerCase();
        tracks = (plRes.data.items || [])
          .map((i: any) => i.track)
          .filter((t: any) => {
            return (
              t.name.toLowerCase().includes(ql) ||
              t.artists.some((a: any) => a.name.toLowerCase().includes(ql))
            );
          });
      } else {
        const srRes = await axios.get("https://api.spotify.com/v1/search", {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { q: query, type: "track", limit: 20 },
        });
        tracks = srRes.data.tracks.items || [];
      }
    } catch (err) {
      res.status(500).json({ error: "Error fetching from Spotify API" });
      return;
    }

    const results = tracks.map((t: any) => ({
      id: t.id,
      name: t.name,
      artists: t.artists.map((a: any) => a.name),
      album: t.album.name,
      uri: t.uri,
      preview_url: t.preview_url,
    }));

    res.status(200).json({ results });
  });
});