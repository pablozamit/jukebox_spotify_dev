// src/app/api/spotify/callback/route.ts
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import axios from 'axios'
import { cookies } from 'next/headers'

// Admin SDK unificado
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

export async function GET(request: NextRequest) {
  const clientId     = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  const redirectUri  = process.env.SPOTIFY_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    console.error('Faltan credenciales Spotify en env')
    return NextResponse.redirect('/admin?error=config_missing')
  }

  try {
    const { searchParams } = new URL(request.url)
    const code  = searchParams.get('code')
    const error = searchParams.get('error')
    const state = searchParams.get('state')

    // ✅ CSRF: validar state
    const cookieStore = await cookies()
    const storedState = cookieStore.get('spotify_auth_state')?.value
    if (!state || state !== storedState) {
      if (storedState) cookieStore.delete('spotify_auth_state')
      console.error('State mismatch')
      return NextResponse.redirect('/admin?error=state_mismatch')
    }
    // borramos cookie ya validada
    cookieStore.delete('spotify_auth_state')

    if (error) {
      console.error('OAuth error param:', error)
      return NextResponse.redirect(`/admin?error=${encodeURIComponent(error)}`)
    }
    if (!code) {
      console.error('No se recibió code')
      return NextResponse.redirect('/admin?error=no_code')
    }

    // 🔄 Exchange code por tokens
    const tokenRes = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization:
            'Basic ' +
            Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
      }
    )

    if (tokenRes.status !== 200 || !tokenRes.data) {
      console.error('Error en token endpoint:', tokenRes.status, tokenRes.data)
      throw new Error('Failed to get tokens')
    }

    const { access_token, refresh_token, expires_in } = tokenRes.data
    if (!access_token || !refresh_token || typeof expires_in !== 'number') {
      console.error('Datos de token incompletos', tokenRes.data)
      throw new Error('Incomplete token data')
    }
    const expiresAt = Date.now() + expires_in * 1000

    // 💾 Guardar en RTDB bajo /admin/spotify/tokens
    await db
      .ref('/admin/spotify/tokens')
      .set({ accessToken: access_token, refreshToken: refresh_token, expiresAt })

    console.log('Tokens Spotify almacenados correctamente')
    return NextResponse.redirect('/admin?success=spotify_connected')
  } catch (e: any) {
    const msg =
      e.response?.data?.error_description ||
      e.response?.data?.error ||
      e.message ||
      'Unknown callback error'
    console.error('Error OAuth callback:', msg)
    return NextResponse.redirect(`/admin?error=${encodeURIComponent(msg)}`)
  }
}
