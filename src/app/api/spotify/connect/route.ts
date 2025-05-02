// src/app/api/spotify/connect/route.ts
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET() {
  const clientId    = process.env.SPOTIFY_CLIENT_ID
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI

  if (!clientId || !redirectUri) {
    console.error('Faltan SPOTIFY_CLIENT_ID o SPOTIFY_REDIRECT_URI')
    return NextResponse.json({ error: 'OAuth no configurado' }, { status: 500 })
  }

  // ① Generar state para CSRF
  const state = Math.random().toString(36).slice(2)

  // ② Guardar state en cookie HTTP-only
  const cookieStore = await cookies()
  cookieStore.set({
    name:     'spotify_auth_state',
    value:    state,
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    path:     '/api/spotify/callback',
    maxAge:   60 * 60, // 1h
  })

  // ③ Construir URL de autorización
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  redirectUri,
    scope:         'user-modify-playback-state user-read-playback-state',
    state,
  })

  const url = `https://accounts.spotify.com/authorize?${params.toString()}`
  return NextResponse.redirect(url)
}
