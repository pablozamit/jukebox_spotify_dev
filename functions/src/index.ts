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
    databaseURL: "https://barjukebox-default-rtdb.europe-west1.fire basedatabase.app",
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

// Mantener getNextTrack para gestionar la lógica de la cola
async function getNextTrack(db: admin.database.Database): Promise<any | null> {
  console.log('getNextTrack: Starting to get next track from queue.');
  const snap = await db.ref('/queue').once('value');
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

// Manejar notificación del frontend cuando una pista termina
export const handleTrackEndNotification = functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    console.log('handleTrackEndNotification: Received track end notification.');
    try {
      const nextSong = await getNextTrack(admin.database());
      const db = admin.database();

      if (nextSong) {
        console.log(`handleTrackEndNotification: Next song found: ${nextSong.title}. Sending play command.`);
        await db.ref('playback/command').set({ action: 'play', uri: `spotify:track:${nextSong.spotifyTrackId}`, timestamp: Date.now() });
        console.log("handleTrackEndNotification: Play command sent to Firebase.");
      } else {
        console.log('handleTrackEndNotification: Queue is empty. Sending pause command.');
        await db.ref('playback/command').set({ action: 'pause', timestamp: Date.now() });
        console.log("handleTrackEndNotification: Pause command sent to Firebase.");
      }
      res.status(200).send({ success: true });
    } catch (error: any) {
      console.error("❌ handleTrackEndNotification: Error:", error.message, error.stack);
      res.status(500).send({ success: false, error: error.message, stack: error.stack });
    }
  });
});

// Manejar confirmación del frontend cuando una pista comienza a reproducirse
export const handleTrackStartedConfirmation = functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    console.log('handleTrackStartedConfirmation: Received track started confirmation.');
    const { spotifyTrackId } = req.body;
    console.log('handleTrackStartedConfirmation: Confirmed track ID:', spotifyTrackId);

    if (!spotifyTrackId) {
      console.warn('handleTrackStartedConfirmation: Missing spotifyTrackId in request body.');
      return res.status(400).send({ success: false, error: 'Missing spotifyTrackId' });
    }

    try {
      const db = admin.database();
      const snapshot = await db.ref('queue').orderByChild('spotifyTrackId').equalTo(spotifyTrackId).once('value');
      const songToRemove = snapshot.val();

      if (songToRemove) {
        const songKey = Object.keys(songToRemove)[0];
        console.log(`handleTrackStartedConfirmation: Found song in queue with key ${songKey}. Removing...`);
        await db.ref(`queue/${songKey}`).remove();
        console.log(`handleTrackStartedConfirmation: Song with ID ${spotifyTrackId} removed from queue.`);
      } else {
        console.log(`handleTrackStartedConfirmation: Song with ID ${spotifyTrackId} not found in queue (might have been removed already).`);
      }
      return res.status(200).send({ success: true });
    } catch (error: any) {
      console.error("❌ handleTrackStartedConfirmation: Error:", error.message, error.stack);
      return res.status(500).send({ success: false, error: error.message, stack: error.stack });
    }
  });
  // Asegurarse de que siempre se envíe una respuesta, incluso si corsHandler falla
  res.status(500).send({ success: false, error: 'CORS handler failed to respond' });
});

// Obtener el token de acceso de Spotify para el frontend
export const getSpotifyAccessToken = functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    console.log("getSpotifyAccessToken: Received request.");
    try {
      const accessToken = await getValidAccessToken();
      console.log("getSpotifyAccessToken: Successfully retrieved/refreshed access token.");
      res.status(200).send({ accessToken });
    } catch (error: any) {
      console.error('❌ getSpotifyAccessToken: Error fetching/refreshing Spotify access token:', error.message, error.stack);
      const statusCode = error.message.includes('No Spotify tokens found') ? 404 : 500;
      res.status(statusCode).send({ error: error.message || 'Internal Server Error', stack: error.stack });
    }
  });
  // Asegurarse de que siempre se envíe una respuesta
  res.status(500).send({ success: false, error: 'CORS handler failed to respond' });
});

// Mantener searchSpotify ya que es una función útil del backend
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
        console.warn("searchSpotify: Tracks is not an array, converting to empty array");
        tracks = [];
      }

      res.status(200).json({ tracks });
    } catch (error: any) {
      console.error("❌ searchSpotify: Error:", error.message, error.stack);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });
});