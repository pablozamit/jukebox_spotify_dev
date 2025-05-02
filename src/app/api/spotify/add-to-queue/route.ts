// src/app/api/spotify/add-to-queue/route.ts

// ➤ Forzamos que este handler se ejecute en Node.js (no en Edge)
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import axios from 'axios'

// ① Importa sólo lo que necesitas del Admin SDK unificado
import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

// Inicializa UNA vez con Application Default Credentials
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  })
}
// Ahora obtenemos la instancia de RTDB
const db = getDatabase()

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID!
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!

export async function POST(request: Request) {
  try {
    // ② Leemos el trackId del body
    const { trackId } = await request.json()
    if (!trackId) {
      return NextResponse.json({ error: 'trackId is required' }, { status: 400 })
    }

    // ③ Leemos los tokens guardados en RTDB bajo /admin/spotify/tokens
    const snap = await db.ref('/admin/spotify/tokens').once('value')
    const tokens = snap.val() as
      | { accessToken: string; refreshToken: string; expiresAt: number }
      | null

    if (!tokens) {
      return NextResponse.json(
        { error: 'No Spotify tokens found. Connect first.' },
        { status: 400 }
      )
    }

    let accessToken = tokens.accessToken
    const now = Date.now()

    // ④ Si expiró, refrescamos y actualizamos en RTDB
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

      await db
        .ref('/admin/spotify/tokens')
        .update({ accessToken, expiresAt: newExpiry })
    }

    // ⑤ Encolamos la pista en Spotify
    const queueRes = await fetch(
      `https://api.spotify.com/v1/me/player/queue?uri=spotify:track:${trackId}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )

    if (!queueRes.ok) {
      const err = await queueRes.json().catch(() => ({}))
      return NextResponse.json(
        { error: err.error?.message || 'Failed to add to Spotify queue' },
        { status: queueRes.status }
      )
    }

    // ⑥ Todo OK
    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('add-to-queue error:', e)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
