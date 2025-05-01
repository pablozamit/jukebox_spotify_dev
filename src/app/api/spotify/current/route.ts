// src/app/api/spotify/current/route.ts

import { NextResponse } from 'next/server'
import axios from 'axios'
import * as admin from 'firebase-admin'

// ❶ Inicializa Admin SDK usando Application Default Credentials si aún no está hecho
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  })
}

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID!
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!

export async function GET() {
  try {
    // ❷ Leemos los tokens guardados en RTDB bajo /spotifyTokens
    const snap = await admin.database().ref('/spotifyTokens').once('value')
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

    // ❸ Si expiró, refrescamos
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

      // ❸.1 Actualizamos la DB con el nuevo token y su expiry
      await admin
        .database()
        .ref('/spotifyTokens')
        .update({ accessToken, expiresAt: newExpiry })
    }

    // ❹ Llamamos a Spotify para saber qué suena ahora
    const playerRes = await axios.get(
      'https://api.spotify.com/v1/me/player/currently-playing',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    // 204 = nada sonando
    if (playerRes.status === 204 || !playerRes.data) {
      return NextResponse.json({ isPlaying: false })
    }

    const data = playerRes.data
    const item = data.item
    if (!item) {
      return NextResponse.json({ isPlaying: false })
    }

    // ❺ Mapear respuesta a nuestro formato
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
    console.error('Error en /api/spotify/currently-playing:', e)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
