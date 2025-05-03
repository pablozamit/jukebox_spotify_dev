// ➤ Fuerza este handler a ejecutarse en Node.js, no en Edge
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { cookies } from 'next/headers';

// ❶ Inicializa Admin SDK si no está iniciado
try {
  if (!admin.apps.length) {
    console.log('[Firebase] Inicializando Admin SDK...');
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log('[Firebase] Admin SDK inicializado.');
  }
} catch (err) {
  console.error('[Firebase] Error al inicializar:', err);
}

export async function GET(request: NextRequest) {
  console.log('[Callback] Entrando en GET /api/spotify/callback');

  try {
    const clientId     = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    const redirectUri  = process.env.SPOTIFY_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      console.error('[Callback] Variables de entorno de Spotify faltantes');
      return NextResponse.redirect('/admin?error=config_missing');
    }

    const { searchParams } = new URL(request.url);
    const code   = searchParams.get('code');
    const error  = searchParams.get('error');
    const state  = searchParams.get('state');

    console.log('[Callback] Parámetros recibidos:');
    console.log('code:', code);
    console.log('error:', error);
    console.log('state:', state);

    const cookieStore = await cookies(); // ← AQUÍ EL await
    const storedState = (await cookieStore.get('spotify_auth_state'))?.value;
    console.log('[Callback] State en cookie:', storedState);

    if (!state || state !== storedState) {
      console.warn('[Callback] State mismatch, posible ataque CSRF');
      await cookieStore.delete('spotify_auth_state');
      return NextResponse.redirect('/admin?error=state_mismatch');
    }
    await cookieStore.delete('spotify_auth_state');

    if (error) {
      console.error('[Callback] Error recibido desde Spotify:', error);
      return NextResponse.redirect(`/admin?error=${encodeURIComponent(error)}`);
    }
    if (!code) {
      console.error('[Callback] No se recibió código de autorización.');
      return NextResponse.redirect('/admin?error=no_code');
    }

    console.log('[Callback] Intercambiando código por tokens...');
    const tokenRes = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization:
            'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
      }
    );

    console.log('[Callback] Respuesta de tokens:', tokenRes.status, tokenRes.data);

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    if (!access_token || !refresh_token || typeof expires_in !== 'number') {
      console.error('[Callback] Tokens incompletos:', tokenRes.data);
      return NextResponse.redirect('/admin?error=incomplete_tokens');
    }

    const expiresAt = Date.now() + expires_in * 1000;

    console.log('[Callback] Guardando tokens en Firebase...');
    await admin
      .database()
      .ref('/admin/spotify/tokens')
      .set({
        accessToken:  access_token,
        refreshToken: refresh_token,
        expiresAt,
      });

    console.log('[Callback] Tokens guardados. Redirigiendo a /admin');
    return NextResponse.redirect('/admin?success=spotify_connected');

  } catch (e: any) {
    const msg = e?.response?.data?.error_description || e?.message || 'Unknown error';
    console.error('[Callback] ERROR FATAL en callback:', msg, e);
    return NextResponse.redirect(`/admin?error=${encodeURIComponent(msg)}`);
  }
}
