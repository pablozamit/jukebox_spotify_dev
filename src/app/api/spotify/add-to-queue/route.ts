// src/app/api/spotify/add-to-queue/route.ts

import { NextResponse } from 'next/server';
import axios from 'axios';
import * as admin from 'firebase-admin';

// ❶ Inicializa Admin SDK si aún no está hecho
if (!admin.apps.length) {
  admin.initializeApp();
}

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!;

export async function POST(request: Request) {
  try {
    // ❷ Obtenemos el trackId del JSON
    const { trackId } = await request.json();
    if (!trackId) {
      return NextResponse.json(
        { error: 'trackId is required' },
        { status: 400 }
      );
    }

    // ❸ Leemos los tokens guardados en RTDB
    const snap = await admin.database().ref('/spotifyTokens').once('value');
    const tokens = snap.val() as {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    };
    if (!tokens) {
      return NextResponse.json(
        { error: 'No Spotify tokens found. Connect first.' },
        { status: 400 }
      );
    }

    let accessToken = tokens.accessToken;
    const now = Date.now();

    // ❹ Si el token expiró, lo refrescamos
    if (now >= tokens.expiresAt) {
      const resp = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type:    'refresh_token',
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
      // Actualizamos la DB
      await admin
        .database()
        .ref('/spotifyTokens')
        .update({ accessToken, expiresAt: newExpiry });
    }

    // ❺ Llamamos a Spotify para encolar la canción
    const queueRes = await fetch(
      `https://api.spotify.com/v1/me/player/queue?uri=spotify:track:${trackId}`,
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

    // ❻ Devolvemos éxito
    return NextResponse.json({ success: true });

  } catch (e) {
    console.error('add-to-queue error:', e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} // <-- Esta llave cierra la función POST
