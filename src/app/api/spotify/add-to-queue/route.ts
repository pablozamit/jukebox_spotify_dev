// ➤ Fuerza este handler a ejecutarse en Node.js, no en Edge
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import axios from 'axios';
import * as admin from 'firebase-admin';

// Inicializa Admin SDK si no está activo
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON!)
    ),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;

export async function POST(request: Request) {
  try {
    // Leer body con el spotifyTrackId
    const { spotifyTrackId } = await request.json();

    if (!spotifyTrackId) {
      return NextResponse.json({ error: 'spotifyTrackId is required' }, { status: 400 });
    }

    // Leer tokens desde Firebase
    const snap = await admin.database().ref('/admin/spotify/tokens').once('value');
    const tokens = snap.val() as
      | { accessToken: string; refreshToken: string; expiresAt: number }
      | null;

    if (!tokens) {
      return NextResponse.json(
        { error: 'No Spotify tokens found. Connect first.' },
        { status: 400 }
      );
    }

    let accessToken = tokens.accessToken;
    const now = Date.now();

    // Refrescar token si ha expirado
    if (now >= tokens.expiresAt) {
      const resp = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization:
              'Basic ' +
              Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
          },
        }
      );

      accessToken = resp.data.access_token;
      const newExpiry = Date.now() + resp.data.expires_in * 1000;

      await admin
        .database()
        .ref('/admin/spotify/tokens')
        .update({ accessToken, expiresAt: newExpiry });
    }

    // Encolar la canción en Spotify
    const queueRes = await fetch(
      `https://api.spotify.com/v1/me/player/queue?uri=spotify:track:${spotifyTrackId}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!queueRes.ok) {
      const err = await queueRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: err.error?.message || 'Failed to add to Spotify queue' },
        { status: queueRes.status }
      );
    }

    console.log(`Successfully added ${spotifyTrackId} to Spotify queue.`);

    // --- Start: Firebase Cleanup Logic ---
    try {
      const db = admin.database();
      const queueRef = db.ref('/queue');

      // Query for entries matching the spotifyTrackId
      const snapshot = await queueRef.orderByChild('spotifyTrackId').equalTo(spotifyTrackId).once('value');

      if (snapshot.exists()) {
        console.log(`Found matching entries in Firebase queue for ${spotifyTrackId}. Removing...`);
        const updates: any = {};
        snapshot.forEach((childSnapshot) => {
          // Prepare updates object to remove each matching entry
          updates[childSnapshot.key!] = null; // Setting to null effectively removes in update()
          console.log(`Marking ${childSnapshot.key} for removal from Firebase queue.`);
        });

        // Perform the removal of all matching entries
        await queueRef.update(updates);
        console.log(`Finished removing matching entries from Firebase queue for ${spotifyTrackId}.`);
      } else {
        console.log(`No matching entries found in Firebase queue for ${spotifyTrackId}. No cleanup needed.`);
      }

    } catch (firebaseCleanupError) {
      console.error(`Error during Firebase queue cleanup for ${spotifyTrackId}:`, firebaseCleanupError);
      // Log this error, but the Spotify add was successful, so we can still return success.
    }
    // --- End: Firebase Cleanup Logic ---

    return NextResponse.json({ success: true, message: 'Song added to Spotify and Firebase queue cleaned.' });

  } catch (e: any) {
    console.error('add-to-queue error:', e);
    // Improved error response
    const errorMessage = e.response?.data?.error?.message || e.message || 'Internal server error';
    const status = e.response?.status || 500;
    return NextResponse.json(
      { error: `Error adding song: ${errorMessage}` },
      { status: status }
    );
  }
}