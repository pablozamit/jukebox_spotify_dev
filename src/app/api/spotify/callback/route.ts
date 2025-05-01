// src/app/api/spotify/callback/route.ts

import { NextRequest, NextResponse } from 'next/server'
import * as admin from 'firebase-admin'
import axios from 'axios'

// ❶ Inicializa Admin SDK si aún no está hecho
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  })
}

const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID!
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!
const REDIRECT_URI  = process.env.SPOTIFY_REDIRECT_URI!

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const error = searchParams.get('error')

    if (error) {
      // Spotify devolvió un error (usuario canceló, por ejemplo)
      console.error('Spotify OAuth error:', error)
      return NextResponse.redirect(new URL('/admin?error=oauth', request.url))
    }

    if (!code) {
      return NextResponse.json(
        { error: 'Missing code from Spotify' },
        { status: 400 }
      )
    }

    // ❷ Intercambiamos el code por tokens
    const tokenRes = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
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

    const { access_token, refresh_token, expires_in } = tokenRes.data
    const expiresAt = Date.now() + expires_in * 1000

    // ❸ Guardamos en RTDB
    await admin
      .database()
      .ref('/spotifyTokens')
      .set({
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt,
      })

    // ❹ Redirigimos de vuelta al admin (puedes ajustar la query si quieres mostrar un toast)
    return NextResponse.redirect(new URL('/admin?connected=true', request.url))

  } catch (e: any) {
    console.error('Error en OAuth callback:', e)
    // Redirigimos con flag de error para que el admin pueda mostrarse un toast
    return NextResponse.redirect(new URL('/admin?connected=false', request.url))
  }
}
