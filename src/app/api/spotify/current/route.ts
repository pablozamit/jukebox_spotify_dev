// src/app/api/spotify/current/route.ts
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import axios from 'axios'
import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

// Inicializa Admin SDK UNA vez
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  })
}
const db = getDatabase()

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID!
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!

export async function GET() {
  try {
    // ① Leer tokens de RTDB
    const snap = await db.ref('/admin/spotify/tokens').once('value')
    const tokens = snap.val() as
      | { accessToken: string; refreshToken: string; expiresAt: number }
      | null

    if (!tokens) {
      return NextResponse.json({ error: 'No Spotify tokens found. Connect first.' }, { status: 400 })
    }

    let accessToken = tokens.accessToken
    const now = Date.now()

    // ② Si expiró, refrescar y actualizar RTDB
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
      await db.ref('/admin/spotify/tokens').update({ accessToken, expiresAt: newExpiry })
    }

    // ③ Llamar al endpoint “currently-playing”
    const playerRes = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (playerRes.status === 204 || !playerRes.data) {
      return NextResponse.json({ isPlaying: false })
    }

    const item = playerRes.data.item
    if (!item) {
      return NextResponse.json({ isPlaying: false })
    }

    // ④ Mapear a nuestro formato
    const track = {
      id:          item.id,
      name:        item.name,
      artists:     item.artists.map((a: any) => a.name),
      albumArtUrl: item.album.images?.[0]?.url ?? null,
      progress_ms: playerRes.data.progress_ms,
      duration_ms: item.duration_ms,
    }

    return NextResponse.json({ isPlaying: true, track })
  } catch (e: any) {
    console.error('Error en /api/spotify/current:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
