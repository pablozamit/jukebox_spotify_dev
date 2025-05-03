// ➤ Fuerza este handler a ejecutarse en Node.js, no en Edge
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { cookies } from 'next/headers';

// ❶ Inicializa Admin SDK con Application Default Credentials
try {
  if (!admin.apps.length) {
    console.log('Inicializando Firebase Admin SDK...');
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL, // ❗ Usa esta env var
    });
    console.log('Firebase Admin SDK inicializado con éxito.');
  }
} catch (err) {
  console.error('Error al inicializar Firebase Admin SDK:', err);
}

export async function GET(request: NextRequest) {
  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri  = process.env.SPOTIFY_REDIRECT_URI;

  console.log('--- Inicio del callback ---');
  console.log('Client ID:', clientId);
  console.log('Redirect URI:', redirectUri);

  if (!clientId || !clientSecret || !redirectUri) {
    console.error('Spotify API credentials missing in environment variables.');
    return NextResponse.redirect('/admin?error=config_missing');
  }

  try {
    const { searchParams } = new URL(request.url);
    const code   = searchParams.get('code');
    const error  = searchParams.get('error');
    const state  = searchParams.get('state');

    console.log('Code recibido de Spotify:', code);
    console.log('Error recibido de Spotify:', error);
    console.log('State recibido de Spotify:', state);

    const cookieStore = await cookies();
    const storedState = cookieStore.get('spotify_auth_state')?.value;
    console.log('State almacenado en la cookie:', storedState);

    if (!state || state !== storedState) {
      if (storedState) cookieStore.delete('spotify_auth_state');
      console.error('State mismatch error. Potential CSRF attack.');
      return NextResponse.redirect('/admin?error=state_mismatch');
    }
    cookieStore.delete('spotify_auth_state');
    console.log('Validación de state exitosa.');

    if (error) {
      console.error('Spotify OAuth error parameter:', error);
      return NextResponse.redirect(`/admin?error=${encodeURIComponent(error)}`);
    }
    if (!code) {
      console.error('Missing authorization code from Spotify.');
      return NextResponse.redirect('/admin?error=no_code');
    }

    console.log('Intercambiando el código por tokens...');
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
            'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        },
      }
    );

    console.log('Respuesta de Spotify:', JSON.stringify(tokenRes.data, null, 2));

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    if (!access_token || !refresh_token || typeof expires_in !== 'number') {
      console.error('Datos de token incompletos:', tokenRes.data);
      throw new Error('Incomplete token data from Spotify');
    }

    const expiresAt = Date.now() + expires_in * 1000;

    console.log('Guardando tokens en RTDB...');
    await admin
      .database()
      .ref('/admin/spotify/tokens')
      .set({
        accessToken:  access_token,
        refreshToken: refresh_token,
        expiresAt,
      });

    console.log('Tokens guardados correctamente.');
    return NextResponse.redirect('/admin?success=spotify_connected');

  } catch (e: any) {
    const msg = e?.response?.data?.error_description || e?.message || 'Unknown error';
    console.error('Error en el callback de Spotify:', msg);
    return NextResponse.redirect(`/admin?error=${encodeURIComponent(msg)}`);
  }
}
