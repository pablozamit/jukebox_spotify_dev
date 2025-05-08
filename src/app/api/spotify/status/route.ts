// ➤ Fuerza este handler a ejecutarse en Node.js, no en Edge
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import axios from 'axios';

// ❶ Inicializa Admin SDK si no está iniciado
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
} catch (err) {
  console.error('[Status] Error al inicializar Firebase Admin:', err);
}

export async function GET() {
  try {
    const tokenSnap = await admin.database().ref('/admin/spotify/tokens').once('value');
    const tokens = tokenSnap.val();

    if (!tokens || !tokens.accessToken || !tokens.expiresAt) {
      return NextResponse.json({
        spotifyConnected: false,
        tokensOk: false,
        playbackAvailable: false,
        reason: 'No hay tokens válidos guardados',
      });
    }

    const now = Date.now();
    if (now >= tokens.expiresAt) {
      return NextResponse.json({
        spotifyConnected: false,
        tokensOk: false,
        playbackAvailable: false,
        reason: 'Token expirado',
      });
    }

    const testResponse = await axios.get('https://api.spotify.com/v1/me/player', {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });

    if (testResponse.status === 200) {
      return NextResponse.json({
        spotifyConnected: true,
        tokensOk: true,
        playbackAvailable: true,
      });
    }

    return NextResponse.json({
      spotifyConnected: true,
      tokensOk: true,
      playbackAvailable: false,
      reason: 'No hay reproducción activa o el token tiene permisos limitados',
    });
  } catch (e: any) {
    console.error('[Status] Error al verificar el estado de Spotify:', e.message);
    return NextResponse.json({
      spotifyConnected: false,
      tokensOk: false,
      playbackAvailable: false,
      reason: e.message || 'Error desconocido',
    });
  }
}
