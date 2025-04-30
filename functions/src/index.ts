import { onRequest } from "firebase-functions/v2/https";
import { config } from "firebase-functions";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import axios from "axios";

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

// Cloud Function: searchSpotify using v2 trigger with CORS enabled
export const searchSpotify = onRequest({ cors: true }, async (req, res) => {
  logger.info("searchSpotify triggered");

  // Only allow GET requests
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  // Retrieve query parameter
  const query = req.query.q as string;
  if (!query) {
    logger.warn("Missing required query parameter 'q'");
    res.status(400).json({ error: "Missing search parameter 'q'" });
    return;
  }
  logger.info(`Search query: ${query}`);

  // Load Spotify credentials from Firebase config
  const spotifyConfig = config().spotify;
  const clientId = spotifyConfig?.client_id;
  const clientSecret = spotifyConfig?.client_secret;
  if (!clientId || !clientSecret) {
    logger.error("Spotify credentials are not configured in Firebase Functions");
    res.status(500).json({ error: "Spotify configuration missing" });
    return;
  }

  try {
    // 1) Obtain Access Token from Spotify
    logger.info("Requesting Spotify access token");
    const tokenRes = await axios.post(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({ grant_type: "client_credentials" }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
      }
    );
    const accessToken = tokenRes.data.access_token as string;

    // 2) Read admin configuration from Realtime Database
    logger.info("Fetching admin config from Realtime Database");
    const configSnap = await admin.database().ref("/config").once("value");
    const dbConfig = configSnap.val() || {};
    const searchMode = dbConfig.searchMode || "all"; // 'all' or 'playlist'
    const playlistId = dbConfig.playlistId;

    let tracks: any[] = [];

    // 3) Conditional search logic
    if (searchMode === "playlist") {
      if (!playlistId) {
        logger.error("Playlist ID not configured for playlist mode");
        res.status(400).json({ error: "Playlist ID not configured" });
        return;
      }
      logger.info(`Searching within playlist ${playlistId}`);
      const playlistRes = await axios.get(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            fields: "items(track(id,name,artists(name),album(name),uri,preview_url))",
            limit: 100,
          },
        }
      );
      const items = playlistRes.data.items || [];
      const qLower = query.toLowerCase();
      tracks = items
        .map((item: any) => item.track)
        .filter((track: any) => {
          const nameMatch = track.name.toLowerCase().includes(qLower);
          const artistMatch = track.artists.some((a: any) => a.name.toLowerCase().includes(qLower));
          return nameMatch || artistMatch;
        });
    } else {
      logger.info(`Performing global search for '${query}'`);
      const searchRes = await axios.get(
        "https://api.spotify.com/v1/search",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { q: query, type: "track", limit: 20 },
        }
      );
      tracks = searchRes.data.tracks.items || [];
    }

    // 4) Format and return results
    const results = tracks.map(track => ({
      id: track.id,
      name: track.name,
      artists: track.artists.map((a: any) => a.name),
      album: track.album.name,
      uri: track.uri,
      preview_url: track.preview_url,
    }));

    logger.info(`Returning ${results.length} results`);
    res.status(200).json({ results });

  } catch (error: any) {
    logger.error("searchSpotify error:", error);
    if (axios.isAxiosError(error)) {
      logger.error("Axios error details:", error.response?.data || error.message);
    }
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});
