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
  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri  = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error('Spotify API credentials missing in environment variables.');
    return NextResponse.redirect('/admin?error=config_missing');
  }

  try {
    const { searchParams } = new URL(request.url);
    const code  = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state');

    // ❷ CSRF: validamos “state” con la cookie
    const cookieStore  = await cookies();
    const storedState  = cookieStore.get('spotify_auth_state')?.value;

    if (!state || state !== storedState) {
      if (storedState) cookieStore.delete('spotify_auth_state');
      console.error('State mismatch error. Potential CSRF attack.');
      return NextResponse.redirect('/admin?error=state_mismatch');
    }
    // Si coincide, borramos la cookie
    cookieStore.delete('spotify_auth_state');

    if (error) {
      console.error('Spotify OAuth error parameter:', error);
      return NextResponse.redirect(`/admin?error=${encodeURIComponent(error)}`);
    }
    if (!code) {
      console.error('Missing authorization code from Spotify.');
      return NextResponse.redirect('/admin?error=no_code');
    }

    // ❸ Intercambiamos el código por tokens
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

    if (tokenRes.status !== 200 || !tokenRes.data) {
      console.error('Invalid response from Spotify token endpoint:', tokenRes.status, tokenRes.data);
      throw new Error('Failed to get tokens from Spotify');
    }

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    if (!access_token || !refresh_token || typeof expires_in !== 'number') {
      console.error('Incomplete token data received:', tokenRes.data);
      throw new Error('Incomplete token data from Spotify');
    }

    const expiresAt = Date.now() + expires_in * 1000;

    // ❹ Guardamos los tokens en RTDB bajo /admin/spotify/tokens
    try {
      await admin
        .database()
        .ref('/admin/spotify/tokens')
        .set({
          accessToken:  access_token,
          refreshToken: refresh_token,
          expiresAt,
        });
      console.log('Spotify tokens successfully stored in RTDB.');
      return NextResponse.redirect('/admin?success=spotify_connected');
    } catch (dbErr: any) {
      console.error('Error saving Spotify tokens in RTDB:', dbErr);
      return NextResponse.redirect('/admin?error=token_save_failed');
    }

  } catch (e: any) {
    const msg = e.response?.data?.error_description
             || e.response?.data?.error
             || e.message
             || 'Unknown callback error';
    console.error('Error in Spotify OAuth callback:', msg, e);
    return NextResponse.redirect(`/admin?error=${encodeURIComponent(msg)}`);
  }
}
