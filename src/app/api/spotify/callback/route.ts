export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import axios from 'axios';

// ❶ Inicializa Admin SDK si no está iniciado
try {
  if (!admin.apps.length) {
    console.log('[Firebase] Inicializando Admin SDK...');
    const raw = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON!);
    admin.initializeApp({
 credential: admin.credential.cert(raw),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log('[Firebase] Admin SDK inicializado.');
  }
} catch (err) {
  console.error('[Firebase] Error al inicializar:', err);
}

export async function GET(request: NextRequest) {
  console.log('[Callback] Entrando en GET /api/spotify/callback');

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  const baseUrl = process.env.BASE_URL;

  if (!clientId || !clientSecret || !redirectUri || !baseUrl) {
    console.error('[Callback] Variables de entorno faltantes');
    return NextResponse.redirect(`${baseUrl}/admin?error=config_missing`);
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  console.log('[Callback] Parámetros recibidos:', { code, error, state });

  const cookieHeader = request.headers.get('cookie') || '';
  const storedState = cookieHeader
    .split(';')
    .find((c) => c.trim().startsWith('spotify_auth_state='))
    ?.split('=')[1];

  if (!state || state !== storedState) {
    console.warn('[Callback] State mismatch, posible ataque CSRF');
    const response = NextResponse.redirect(`${baseUrl}/admin?error=state_mismatch`);
    response.headers.set('Set-Cookie', 'spotify_auth_state=; Path=/; Max-Age=0');
    return response;
  }

  if (error) {
    console.error('[Callback] Error recibido desde Spotify:', error);
    const response = NextResponse.redirect(`${baseUrl}/admin?error=${encodeURIComponent(error)}`);
    response.headers.set('Set-Cookie', 'spotify_auth_state=; Path=/; Max-Age=0');
    return response;
  }

  if (!code) {
    console.error('[Callback] No se recibió código de autorización.');
    const response = NextResponse.redirect(`${baseUrl}/admin?error=no_code`);
    response.headers.set('Set-Cookie', 'spotify_auth_state=; Path=/; Max-Age=0');
    return response;
  }

  console.log('[Callback] Intercambiando código por tokens...');
  try {
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
          Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
      }
    );

    const { access_token, refresh_token, expires_in, scope, token_type } = tokenRes.data;

    if (!access_token || !refresh_token || typeof expires_in !== 'number') {
      console.error('[Callback] Tokens incompletos:', tokenRes.data);
      const response = NextResponse.redirect(`${baseUrl}/admin?error=incomplete_tokens`);
      response.headers.set('Set-Cookie', 'spotify_auth_state=; Path=/; Max-Age=0');
      return response;
    }

    const expiresAt = Date.now() + expires_in * 1000;

    console.log('[Callback] Guardando tokens en Firebase...');
    await admin.database().ref('/admin/spotify/tokens').set({
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt,
      scope,
      tokenType: token_type,
      createdAt: Date.now(),
    });

    const response = NextResponse.redirect(`${baseUrl}/admin?success=spotify_connected`);
    response.headers.set('Set-Cookie', 'spotify_auth_state=; Path=/; Max-Age=0');
    return response;
  } catch (e: any) {
    const msg = e?.response?.data?.error_description || e?.message || 'Unknown error';
    console.error('[Callback] ERROR FATAL en callback:', msg, e);
    const response = NextResponse.redirect(`${baseUrl}/admin?error=${encodeURIComponent(msg)}`);
    response.headers.set('Set-Cookie', 'spotify_auth_state=; Path=/; Max-Age=0');
    return response;
  }
}
