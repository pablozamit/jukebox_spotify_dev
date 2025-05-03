// ➤ Fuerza este handler a ejecutarse en Node.js, no en Edge
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { cookies } from 'next/headers';

// ❶ Inicializa Admin SDK con Application Default Credentials
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  });
}

export async function GET(request: NextRequest) {
  const clientId       = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri  = process.env.SPOTIFY_REDIRECT_URI;

  console.log('--- Inicio del callback ---');
  console.log('Client ID:', clientId);
  console.log('Redirect URI:', redirectUri);

  if (!clientId || !clientSecret || !redirectUri) {
    console.error('Spotify API credentials missing in environment variables.');
    console.log('--- Fin del callback (error: config missing) ---');
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

    // ❷ CSRF: validamos “state” con la cookie
    const cookieStore   = await cookies();
    const storedState   = cookieStore.get('spotify_auth_state')?.value;
    console.log('State almacenado en la cookie:', storedState);

    if (!state || state !== storedState) {
      if (storedState) cookieStore.delete('spotify_auth_state');
      console.error('State mismatch error. Potential CSRF attack.');
      console.log('--- Fin del callback (error: state mismatch) ---');
      return NextResponse.redirect('/admin?error=state_mismatch');
    }
    // Si coincide, borramos la cookie
    cookieStore.delete('spotify_auth_state');
    console.log('Validación de state exitosa.');

    if (error) {
      console.error('Spotify OAuth error parameter:', error);
      console.log('--- Fin del callback (error desde Spotify) ---');
      return NextResponse.redirect(`/admin?error=${encodeURIComponent(error)}`);
    }
    if (!code) {
      console.error('Missing authorization code from Spotify.');
      console.log('--- Fin del callback (error: no code) ---');
      return NextResponse.redirect('/admin?error=no_code');
    }

    // ❸ Intercambiamos el código por tokens
    console.log('Intentando intercambiar el código por tokens...');
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
    );

    console.log('Respuesta de la API de Spotify (tokens):', JSON.stringify(tokenRes.data, null, 2));

    if (tokenRes.status !== 200 || !tokenRes.data) {
      console.error('Invalid response from Spotify token endpoint:', tokenRes.status, tokenRes.data);
      console.log('--- Fin del callback (error: invalid token response) ---');
      throw new Error('Failed to get tokens from Spotify');
    }

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    console.log('Access Token recibido:', access_token);
    console.log('Refresh Token recibido:', refresh_token);
    console.log('Expires In:', expires_in);

    if (!access_token || !refresh_token || typeof expires_in !== 'number') {
      console.error('Incomplete token data received:', tokenRes.data);
      console.log('--- Fin del callback (error: incomplete token data) ---');
      throw new Error('Incomplete token data from Spotify');
    }

    const expiresAt = Date.now() + expires_in * 1000;
    console.log('Expires At:', new Date(expiresAt).toISOString());

    // ❹ Guardamos los tokens en RTDB bajo /admin/spotify/tokens
    console.log('Intentando guardar tokens en RTDB...');
    try {
      await admin
        .database()
        .ref('/admin/spotify/tokens')
        .set({
          accessToken:   access_token,
          refreshToken: refresh_token,
          expiresAt,
        });
      console.log('Spotify tokens successfully stored in RTDB.');
      console.log('--- Fin del callback (éxito) ---');
      return NextResponse.redirect('/admin?success=spotify_connected');
    } catch (dbErr: any) {
      console.error('Error saving Spotify tokens in RTDB:', dbErr);
      console.log('--- Fin del callback (error: token save failed) ---');
      return NextResponse.redirect('/admin?error=token_save_failed');
    }

  } catch (e: any) {
    const msg = e.response?.data?.error_description
                || e.response?.data?.error
                || e.message
                || 'Unknown callback error';
    console.error('Error in Spotify OAuth callback:', msg, e);
    console.log('--- Fin del callback (error general) ---');
    return NextResponse.redirect(`/admin?error=${encodeURIComponent(msg)}`);
  }
}