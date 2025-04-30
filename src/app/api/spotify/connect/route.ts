// src/app/api/spotify/connect/route.ts

import { NextResponse } from 'next/server';

export async function GET() {
  const params = new URLSearchParams({
    client_id:     process.env.SPOTIFY_CLIENT_ID!,
    response_type: 'code',
    redirect_uri:  process.env.SPOTIFY_REDIRECT_URI!,
    scope:         'user-modify-playback-state user-read-playback-state',
    state:         Math.random().toString(36).slice(2)
  });

  return NextResponse.redirect(
    `https://accounts.spotify.com/authorize?${params.toString()}`
  );
}
