// src/app/api/spotify/callback/route.ts

import { NextRequest, NextResponse } from 'next/server';
// ❶ Importa SÓLO el servicio de DB desde tu archivo de inicialización central del Client SDK
import { db } from '@/lib/firebase'; // Asegúrate que este archivo existe y es correcto para el Client SDK
// Importa las funciones necesarias del Client SDK para la base de datos
import { ref, set } from 'firebase/database';
// Importa cookies para manejar el 'state' de seguridad CSRF
import { cookies } from 'next/headers';
// Puedes seguir usando axios si lo prefieres, o cambiar a fetch
import axios from 'axios';

export async function GET(request: NextRequest) {
  // Leer variables de entorno aquí dentro para mayor seguridad
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  // Validar que las variables de entorno estén cargadas
  if (!clientId || !clientSecret || !redirectUri) {
    console.error('Spotify API credentials missing in environment variables.');
    // Redirección CORREGIDA:
    return NextResponse.redirect('/admin?error=config_missing');
  }

  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state'); // Leer el state devuelto por Spotify

    // ❸ Validar el 'state' contra el almacenado en la cookie (CON AWAIT)
    // Obtén el objeto de cookies esperando la promesa
    const cookieStore = await cookies();
    const storedState = cookieStore.get('spotify_auth_state')?.value;

    // Es mejor borrar la cookie DESPUÉS de haberla validado
    if (!state || state !== storedState) {
      // Borrar la cookie incluso si hay error para limpiar
      if (storedState) { // Solo si existía
        cookieStore.delete('spotify_auth_state');
      }
      console.error('State mismatch error. Potential CSRF attack.');
      // Redirección CORREGIDA:
      return NextResponse.redirect('/admin?error=state_mismatch');
    }
    // Si el state es válido, borramos la cookie ahora sí
    cookieStore.delete('spotify_auth_state');


    // Manejar error devuelto por Spotify (ej. usuario canceló)
    if (error) {
      console.error('Spotify OAuth error parameter:', error);
      // Redirección CORREGIDA:
      return NextResponse.redirect(`/admin?error=${encodeURIComponent(error)}`);
    }

    // Asegurar que tenemos el código
    if (!code) {
      console.error('Missing authorization code from Spotify.');
      // Redirección CORREGIDA:
      return NextResponse.redirect('/admin?error=no_code');
    }

    // ❹ Intercambiar el código por tokens usando axios
    const tokenRes = await axios.post(
      'https://accounts.spotify.com/api/token', // URL CORRECTA del endpoint de token de Spotify
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
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

    // Validar la respuesta de Spotify
    if (tokenRes.status !== 200 || !tokenRes.data) {
      console.error('Invalid response from Spotify token endpoint:', tokenRes.status, tokenRes.data);
      throw new Error('Failed to get tokens from Spotify');
    }

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    // Comprobar que recibimos los tokens esperados
    if (!access_token || !refresh_token || typeof expires_in !== 'number') {
      console.error('Incomplete token data received:', tokenRes.data);
      throw new Error('Incomplete token data from Spotify');
    }

    const expiresAt = Date.now() + expires_in * 1000;

    // ❺ Guardar en RTDB usando el Client SDK
    try {
      if (db) {
        const adminSpotifyRef = ref(db, 'admin/spotify/tokens'); // Guarda los tokens bajo un nodo 'tokens'
        await set(adminSpotifyRef, {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt: expiresAt,
        });
        console.log('Spotify tokens successfully obtained and stored in RTDB using Client SDK.');
        return NextResponse.redirect('/admin?success=spotify_connected_client_sdk'); // Mensaje diferente para distinguir
      } else {
        console.error('Error: Firebase Client SDK database instance is null. Cannot save tokens.');
        return NextResponse.redirect('/admin?error=db_not_available');
      }
    } catch (error: any) {
      console.error('Error saving Spotify tokens with Client SDK:', error);
      return NextResponse.redirect('/admin?error=token_save_failed_client_sdk');
    }

  } catch (e: any) {
    // Captura errores de red (axios), errores de lógica, o errores de escritura en DB
    const errorMessage = e.response?.data?.error_description || e.response?.data?.error || e.message || 'Unknown callback error';
    console.error('Error in Spotify OAuth callback:', errorMessage, e);
    // Redirigir con flag de error genérico o específico si es posible
    // Redirección CORREGIDA:
    return NextResponse.redirect(`/admin?error=${encodeURIComponent(errorMessage)}`);
  }
}