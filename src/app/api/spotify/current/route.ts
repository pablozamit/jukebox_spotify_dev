// src/app/api/spotify/current/route.ts

import { NextResponse } from 'next/server'
import axios from 'axios'

// —— Import modular de Firebase Admin ——
import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

// ① Inicializa Admin SDK (solo una vez)
if (!getApps().length) {
  initializeApp({
    // credenciales sacadas de tu .env.local
    credential: cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      // reemplaza las secuencias "\n" de vuelta a saltos de línea reales
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    }),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL!,
  })
}

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID!
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!

export async function GET() {
  try {
    // ② Leer tokens guardados en RTDB
    const db = getDatabase()
    const snap = await db.ref('/spotifyTokens').once('value')
    const tokens = snap.val() as {
      accessToken: string
      refreshToken: string
      expiresAt: number
    }
    if (!tokens) {
      return NextResponse.json(
        { error: 'No Spotify tokens found. Connect first.' },
        { status: 400 }
      )
    }

    let accessToken = tokens.accessToken
    const now = Date.now()

    // ③ Si expiró, refrescamos
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
      )
      accessToken = resp.data.access_token
      const newExpiry = Date.now() + resp.data.expires_in * 1000
      // actualizar RTDB
      await db.ref('/spotifyTokens').update({ accessToken, expiresAt: newExpiry })
    }

    // ④ Llamar a Spotify para saber qué suena ahora
    const playerRes = await axios.get(
      'https://api.spotify.com/v1/me/player/currently-playing',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (playerRes.status === 204 || !playerRes.data) {
      return NextResponse.json({ isPlaying: false })
    }

    const data = playerRes.data
    const item = data.item
    if (!item) {
      return NextResponse.json({ isPlaying: false })
    }

    // ⑤ Mapeamos a un formato sencillo
    const track = {
      id:          item.id,
      name:        item.name,
      artists:     item.artists.map((a: any) => a.name),
      albumArtUrl: item.album.images?.[0]?.url ?? null,
      progress_ms: data.progress_ms,
      duration_ms: item.duration_ms,
    }

    return NextResponse.json({
      isPlaying: true,
      track,
    })
  } catch (e: any) {
    console.error('Error en /api/spotify/current:', e)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
