// src/app/api/spotify/transfer-playback/route.ts

import { NextResponse } from 'next/server';
import { getSpotifyAccessToken, spotifyApi } from '@/services/spotify';

export async function POST(req: Request) {
  try {
    const { device_id } = await req.json();

    if (!device_id) {
      return NextResponse.json({ error: 'No device_id provided' }, { status: 400 });
    }

    const accessToken = await getSpotifyAccessToken();
    spotifyApi.setAccessToken(accessToken);

    await spotifyApi.transferMyPlayback(
      [device_id],
      { play: false } // No empezamos a reproducir inmediatamente
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error en transfer-playback:', error);
    return NextResponse.json(
      { error: error.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
