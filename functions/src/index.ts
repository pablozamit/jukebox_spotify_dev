/* eslint-disable object-curly-spacing, quote-props, max-len */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import axios from "axios";
import cors from "cors";

const corsHandler = cors({ origin: true });

if (!admin.apps.length) {
  admin.initializeApp();
}

export const searchSpotify = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    // Solo GET
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method Not Allowed" });
      return;
    }

    // Parámetro q
    const query = req.query.q as string;
    if (!query) {
      res.status(400).json({ error: "Missing parameter 'q'" });
      return;
    }

    // 1) Obtener token de Spotify
    const cfg = functions.config().spotify;
    if (!cfg.client_id || !cfg.client_secret) {
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

    // 2) Leer /config de Realtime Database
    const snap = await admin.database().ref("/config").once("value");
    const db = snap.val() || {};
    const mode = db.searchMode || "all";
    const pid = db.playlistId as string;

    let tracks: any[] = [];

    // 3) Lógica de búsqueda
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
              fields:
                "items(track(id,name,artists(name),album(name),uri,preview_url))",
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

    // 4) Formatear y devolver
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
